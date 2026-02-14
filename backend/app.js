require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const authRoutes = require("./src/routes/auth.routes");
const walletRoutes = require("./src/routes/wallet.routes");
const authMiddleware = require("./src/middlewares/auth.middleware");
const kycRoutes = require("./src/routes/kyc.routes");

const app = express();

app.use(morgan("dev"));
app.use(cors());
app.use(express.json());
app.use("/kyc", kycRoutes);

app.use("/auth", authRoutes);
app.use("/wallet", authMiddleware, walletRoutes);

app.get("/health", (req, res) => {
    res.json({status: "OK"});
});


app.get("/", (req, res) => {
  res.status(200).json({ ok: true, service: "JeezPay API" });
});

app.get("/health", (req, res) => {
  res.status(200).json({ ok: true });
});

app.get("/me", authMiddleware, (req, res) => {
    res.json({user: req.user});
});
module.exports = app;