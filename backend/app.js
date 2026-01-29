const express = require('express');
const cors = require('cors');

const authRoutes = require("./src/routes/auth.routes");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
    res.json({status: "OK"});
});

app.use("/auth", authRoutes);
module.exports = app;