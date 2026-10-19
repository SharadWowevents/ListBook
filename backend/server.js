require("dotenv").config();
const express = require("express");
const cors = require("cors");
const connectDB = require("./config/db");

const authRoutes = require("./routes/authRoutes");
const boardRoutes = require("./routes/boardRoutes");
const mcpRoutes = require("./routes/mcpRoutes");

const app = express();

// Connect to MongoDB
connectDB();

// Middleware
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// Discovery routes (RFC 8414 & RFC 9728)
app.get("/.well-known/oauth-authorization-server", mcpRoutes.discoveryHandler);
app.get("/.well-known/oauth-protected-resource", mcpRoutes.protectedResourceHandler);
app.get("/.well-known/openid-configuration", mcpRoutes.discoveryHandler);
app.post("/register", mcpRoutes.registrationHandler);

app.get("/api/.well-known/oauth-authorization-server", mcpRoutes.discoveryHandler);
app.get("/api/.well-known/oauth-protected-resource", mcpRoutes.protectedResourceHandler);
app.get("/api/.well-known/openid-configuration", mcpRoutes.discoveryHandler);
app.post("/api/register", mcpRoutes.registrationHandler);

// Fallback token and authorize routes
app.post(["/token", "/api/token"], mcpRoutes.tokenHandler);
app.use(["/authorize", "/api/authorize"], mcpRoutes);

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/board", boardRoutes);
app.use("/api/mcp", mcpRoutes);
app.use("/api/oauth", mcpRoutes);

// Health check
app.get("/api/health", (req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Listbook API running on port ${PORT}`));