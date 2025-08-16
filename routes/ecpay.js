// routes/ecpay.js
const express = require("express");
const router = express.Router();
require("dotenv").config();

const ECPayService = require("../services/ecpayService");

// 讀取環境變數
const { MERCHANTID, HASHKEY, HASHIV, RETURN_URL, CLIENT_BACK_URL } =
  process.env;
const SPRING_BASE = process.env.SPRING_BASE || "http://localhost:8080";

// ✅ 新增：控制導回頁的開關（1=回 Node 測試頁；0/未設=回 Spring 完成頁）
const USE_NODE_RETURN = process.env.USE_NODE_RETURN === "1";
const NODE_BASE = process.env.NODE_BASE || "http://localhost:3000";

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
 * 購物車送單 → 產生綠界表單
 * POST /ecpay/checkout
 * body: { amount, itemName }
 */
router.post("/checkout", async (req, res, next) => {
  try {
    const { amount, itemName } = req.body;

    // 1) 基本驗證
    const amt = Number(amount);
    if (!amt || amt <= 0) return res.status(400).send("金額不合法");
    const safeItemName = (itemName || "未命名商品").toString().slice(0, 50);

    // 2) 依環境變數決定「導回頁」
    const overrides = USE_NODE_RETURN
      ? { ClientBackURL: `${NODE_BASE}/ecpay/clientReturn` } // 測試：回 Node 頁
      : {}; // 正式：用 Zeabur 的 CLIENT_BACK_URL（回 Spring）

    // 3) 產生 ECPay 參數
    const params = ecpayService.generatePaymentParams(
      amt,
      "購物車結帳",
      safeItemName,
      overrides
    );

    if (USE_NODE_RETURN) {
      console.log(
        `[checkout] USE_NODE_RETURN=1 → 導回 ${NODE_BASE}/ecpay/clientReturn`
      );
    } else {
      console.log(`[checkout] USE_NODE_RETURN=0 → 導回 ${CLIENT_BACK_URL}`);
    }

    // 4) 回傳 HTML 表單（瀏覽器自動送綠界）
    const formHtml = ecpayService.createPaymentForm(params);
    res.type("html").send(formHtml);
  } catch (err) {
    next(err);
  }
});

/** 綠界 Server-to-Server 回傳 */
router.post("/return", async (req, res, next) => {
  try {
    if (!req.body || !Object.keys(req.body).length) {
      return res.status(400).send("缺少回調數據");
    }
    const result = ecpayService.verifyCheckMacValue(req.body);
    if (result.isValid) {
      // TODO：此處可寫 DB / 轉發 Spring（目前先回 1|OK）
      return res.send("1|OK");
    }
    res.status(400).send("簽章驗證失敗");
  } catch (err) {
    next(err);
  }
});

// ✅ n8n → Node.js 的內部通知端點（寫庫或轉發給 Spring 用）
router.post("/notify", async (req, res, next) => {
  try {
    // 1) 驗安全頭
    const token = req.get("x-webhook-token");
    if (token !== process.env.NOTIFY_SECRET) {
      return res.status(403).send("Forbidden");
    }

    // 2) 拿到 n8n 轉來的 form-urlencoded 資料
    const p = req.body || {};
    const payload = {
      MerchantTradeNo: p.MerchantTradeNo,
      TradeNo: p.TradeNo,
      RtnCode: p.RtnCode,
      RtnMsg: p.RtnMsg,
      TradeAmt: p.TradeAmt,
      PaymentDate: p.PaymentDate,
      PaymentType: p.PaymentType,
      PaymentTypeChargeFee: p.PaymentTypeChargeFee,
      SimulatePaid: p.SimulatePaid,
    };

    console.log("[notify] received from n8n:", payload);

    // 3) 例：轉發給 Spring（可改為直接寫 DB）
    const r = await fetch(`${SPRING_BASE}/api/payments/notify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-token": process.env.NOTIFY_SECRET,
      },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const txt = await r.text();
      console.error("forward to Spring failed:", r.status, txt);
      // 仍回 200 避免重送風暴
    }

    // 4) 告知 n8n 已收妥
    return res.status(200).send("ok");
  } catch (err) {
    next(err);
  }
});

/** 使用者導回頁（僅測試用） */
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
