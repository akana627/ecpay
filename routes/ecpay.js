// routes/ecpay.js
const express = require("express");
const router = express.Router();
require("dotenv").config();

const ECPayService = require("../services/ecpayService");

// 讀取環境變數
const { MERCHANTID, HASHKEY, HASHIV, RETURN_URL, CLIENT_BACK_URL } =
  process.env;
const SPRING_BASE = process.env.SPRING_BASE || "http://localhost:8080"; // 👈 你的 Spring 位址

// 檢查必要參數
if (!MERCHANTID || !HASHKEY || !HASHIV || !RETURN_URL || !CLIENT_BACK_URL) {
  console.error(
    "環境變數缺少：MERCHANTID / HASHKEY / HASHIV / RETURN_URL / CLIENT_BACK_URL"
  );
  process.exit(1);
}

// 建立服務實例
const ecpayService = new ECPayService({
  MerchantID: MERCHANTID,
  HashKey: HASHKEY,
  HashIV: HASHIV,
  ReturnURL: RETURN_URL,
  ClientBackURL: CLIENT_BACK_URL,
});

/** 測試頁（可選） */
router.get("/", async (req, res, next) => {
  try {
    const params = ecpayService.generatePaymentParams();
    const formHtml = ecpayService.createPaymentForm(params);
    res.render("index", { title: "綠界支付測試", html: formHtml });
  } catch (err) {
    next(err);
  }
});

/**
 * 購物車送單 → 先向 Spring 建單 → 產生綠界表單
 * POST /ecpay/checkout
 * body: { amount, itemName, userId? }
 */
/*==測試完再開==
router.post("/checkout", async (req, res, next) => {
  try {
    const { amount, itemName, userId } = req.body;

    // 1) 基本驗證
    const amt = Number(amount);
    if (!amt || amt <= 0) return res.status(400).send("金額不合法");
    const safeItemName = (itemName || "未命名商品").toString().slice(0, 50);

    // 2) 向 Spring 建一筆訂單，拿到 orderId
    const r = await fetch(`${SPRING_BASE}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: amt, itemName: safeItemName, userId }),
    });
    const data = await r.json();
    if (!r.ok || !data?.orderId) {
      const msg = typeof data === "object" ? JSON.stringify(data) : String(data);
      throw new Error(`建立訂單失敗：${msg}`);
    }
    const orderId = data.orderId;

    // 3) 產生 ECPay 參數：把 orderId 放在 CustomField1，並在導回頁夾帶 orderId
    const params = ecpayService.generatePaymentParams(
      amt,
      "購物車結帳",
      safeItemName,
      {
        CustomField1: String(orderId),
        ClientBackURL: `${CLIENT_BACK_URL}?orderId=${orderId}`,
      }
    );

    // 4) 生成 HTML 表單並回傳（瀏覽器會自動送出到綠界）
    const formHtml = ecpayService.createPaymentForm(params);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(formHtml);
  } catch (err) { next(err); }
});
*/

// routes/ecpay.js（只示範 /checkout 這段）===測試段===
const NODE_BASE = process.env.NODE_BASE || "http://localhost:3000";

router.post("/checkout", async (req, res, next) => {
  try {
    const { amount, itemName } = req.body;

    const amt = Number(amount);
    if (!amt || amt <= 0) return res.status(400).send("金額不合法");

    const safeItemName = (itemName || "未命名商品").toString().slice(0, 50);

    // 👇關鍵：把導回頁改到 Node 自己的 /ecpay/clientReturn
    const params = ecpayService.generatePaymentParams(
      amt,
      "購物車結帳",
      safeItemName,
      {
        ClientBackURL: `${NODE_BASE}/ecpay/clientReturn`,
      }
    );

    const formHtml = ecpayService.createPaymentForm(params);
    res.type("html").send(formHtml);
  } catch (err) {
    next(err);
  }
});
//===============================================
/** 綠界 Server-to-Server 回傳 */
router.post("/return", async (req, res, next) => {
  try {
    if (!req.body || !Object.keys(req.body).length) {
      return res.status(400).send("缺少回調數據");
    }
    const result = ecpayService.verifyCheckMacValue(req.body);
    if (result.isValid) {
      // TODO：之後可在這裡回寫 Spring / DB（目前先保持不動）
      return res.send("1|OK");
    }
    res.status(400).send("簽章驗證失敗");
  } catch (err) {
    next(err);
  }
});

// ✅ n8n → Node.js 的內部通知端點（寫庫或轉發給 Spring 用）==
router.post('/notify', async (req, res, next) => {
  try {
    // 1) 檢查自訂安全頭（跟 .env 的 NOTIFY_SECRET 必須一致）
    const token = req.get('x-webhook-token');
    if (token !== process.env.NOTIFY_SECRET) {
      return res.status(403).send('Forbidden'); // 驗證失敗
    }

    // 2) 拿到 n8n 轉來的表單資料（n8n 設的是 form-urlencoded）
    const p = req.body || {};
    // 這些鍵要和你在 n8n HTTP Request node「Body Parameters」送的一致
    const payload = {
      MerchantTradeNo: p.MerchantTradeNo,
      TradeNo:        p.TradeNo,
      RtnCode:        p.RtnCode,
      RtnMsg:         p.RtnMsg,
      TradeAmt:       p.TradeAmt,
      PaymentDate:    p.PaymentDate,
      PaymentType:    p.PaymentType,
      PaymentTypeChargeFee: p.PaymentTypeChargeFee,
      SimulatePaid:   p.SimulatePaid,
    };

    console.log('[notify] received from n8n:', payload);

    // 3) 在這裡做你要的事：
    //    - 寫入你自己的 DB
    //    - 或者轉發給 Spring Boot
    //    下方是「轉發給 Spring」的範例（可選）：
    
    const r = await fetch(`${SPRING_BASE}/api/payments/notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-token': process.env.NOTIFY_SECRET, // 可一起驗
      },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const txt = await r.text();
      console.error('forward to Spring failed:', r.status, txt);
      // 不要擋住 n8n：仍回 200 避免重送風暴
    }
    

    // 4) 告知 n8n 已收妥（200 即可；不用回 "1|OK"）
    return res.status(200).send('ok');
  } catch (err) {
    next(err);
  }
});
//===============================================


/** 使用者導回頁 */
router.get("/clientReturn", (req, res, next) => {
  try {
    res.render("return", {
      query: req.query,
      success: req.query?.RtnCode === "1",
      message: req.query?.RtnMsg || "支付完成",
    });
  } catch (err) {
    next(err);
  }
});

/** 通用錯誤處理 */
router.use((err, _req, res, _next) => {
  console.error("路由錯誤:", err);
  res
    .status(500)
    .json({ success: false, message: err.message || "內部伺服器錯誤" });
});

module.exports = router;
