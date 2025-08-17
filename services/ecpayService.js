// services/ecpayService.js
const ecpay_payment = require("ecpay_aio_nodejs");

class ECPayService {
  constructor({ MerchantID, HashKey, HashIV, ReturnURL, ClientBackURL }) {
    this.ReturnURL = ReturnURL;
    this.ClientBackURL = ClientBackURL;

    this.options = {
      OperationMode: "Test",
      MercProfile: { MerchantID, HashKey, HashIV },
      IgnorePayment: [],
      IsProjectContractor: false,
    };

    this.ecpayInstance = new ecpay_payment(this.options);
  }

  // 交易編號：測試用帶前綴 + 時戳，避免重複
  generateTradeNo() {
    // 用 base36 壓縮長度，轉大寫，僅英數
    const ts = Date.now().toString(36).toUpperCase(); // 例如 K4Z3H8
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase(); // 4碼隨機
    const raw = `T${ts}${rand}`; // 例如 TK4Z3H8ABCD
    return raw.slice(0, 20); // 確保 ≤ 20
  }

  // 綠界要求的日期格式 (yyyy/MM/dd HH:mm:ss)，用 zh-TW + Asia/Taipei 組出來
  formatTradeDate() {
    const pad = (n) => n.toString().padStart(2, "0");
    const d = new Date(); // 本機時間
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const HH = pad(d.getHours());
    const MM = pad(d.getMinutes());
    const SS = pad(d.getSeconds());
    return `${yyyy}/${mm}/${dd} ${HH}:${MM}:${SS}`;
  }

  // 簡單清洗商品名稱/描述，避免特殊字或過長
  sanitizeText(input, max = 200) {
    const s = (input || "").toString().trim();
    return s.replace(/[^\w\u4e00-\u9fa5\s\-\+\(\)\*\.,\/#]/g, "").slice(0, max);
  }

  // 產生送綠界的欄位（補上必要欄位）
  generatePaymentParams(
    amount = "100",
    description = "測試交易描述",
    itemName = "測試商品等",
    overrides = {}
  ) {
    // 金額：綠界要整數字串
    const intAmount = parseInt(amount, 10);
    const safeAmount =
      Number.isFinite(intAmount) && intAmount > 0 ? String(intAmount) : "1";

    const base = {
      MerchantTradeNo: this.generateTradeNo(),
      MerchantTradeDate: this.formatTradeDate(),
      TotalAmount: safeAmount,
      TradeDesc: this.sanitizeText(description, 200),
      ItemName: this.sanitizeText(itemName, 200),

      // 你的回呼/導回
      ReturnURL: this.ReturnURL,
      ClientBackURL: this.ClientBackURL,

      // ✅ 綠界 AioCheckOut 必備欄位
      ChoosePayment: "ALL", // 或 'Credit'，先用 ALL 比較好測
      EncryptType: 1, // ✅ 使用 SHA256 時固定為 1

      // （可選）
      // NeedExtraPaidInfo: 'Y',
      // CustomField1: 'meta-xxx',
    };

    // 允許外部覆寫
    return { ...base, ...overrides };
  }

  // 產生 auto-post 的表單 HTML
  createPaymentForm(params) {
    return this.ecpayInstance.payment_client.aio_check_out_all(params);
  }

  // 簽章驗證（綠界回呼 /return 用）
  verifyCheckMacValue(data) {
    const { CheckMacValue, ...verificationData } = data;
    const calculated =
      this.ecpayInstance.payment_client.helper.gen_chk_mac_value(
        verificationData
      );
    return {
      isValid: CheckMacValue === calculated,
      received: CheckMacValue,
      calculated,
    };
  }
}

module.exports = ECPayService;
