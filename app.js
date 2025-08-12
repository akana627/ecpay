var createError = require("http-errors");
var express = require("express");
var path = require("path");
var cookieParser = require("cookie-parser");
var logger = require("morgan");

require("dotenv").config();

var usersRouter = require("./routes/users");
var ecpayRouter = require("./routes/ecpay");

var app = express();

/* 讓反向代理（ngrok/Zeabur）後的 req.ip、req.secure 正確 */
app.set("trust proxy", 1);

// view engine setup
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

/* 首頁（暫時測試用） */
app.get("/", (req, res) => {
  res.render("index", { title: "首頁", html: "" });
});

/* 業務路由 */
app.use("/users", usersRouter);
app.use("/ecpay", ecpayRouter);

/* 健康檢查（放在 404 前） */
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    service: "ECPay Payment Service",
    environment: process.env.NODE_ENV || "development",
  });
});
app.head("/health", (req, res) => res.status(200).end()); // 監控工具常用

/* 404 */
app.use(function (req, res, next) {
  next(createError(404));
});

/* 只要是 /ecpay* 的錯誤，一律回 JSON（避免渲染 ejs） */
app.use(function (err, req, res, next) {
  if (req.path && req.path.startsWith("/ecpay")) {
    return res
      .status(err.status || 500)
      .json({ error: err.message || "Server Error" });
  }
  return next(err);
});

/* 其他錯誤：用原本的 ejs error 頁 */
app.use(function (err, req, res, next) {
  res.locals.message = err.message;
  res.locals.error = req.app.get("env") === "development" ? err : {};
  res.status(err.status || 500);
  res.render("error");
});

module.exports = app;
