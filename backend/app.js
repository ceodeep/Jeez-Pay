require('dotenv').config();
const express = require("express");
const cors = require("cors");

const authRoutes = require("./src/routes/auth.routes");
const authMiddleware = require("./src/middlewares/auth.middleware");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
    res.json({status: "OK"});
});

app.use("/auth", authRoutes);


app.get("/me", authMiddleware, (req, res) => {
    res.json({user: req.user});
});
module.exports = app;