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
app.set("trust proxy", true);
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// Discovery routes (RFC 8414 & RFC 9728)
app.get(
  [
    "/.well-known/oauth-authorization-server",
    "/.well-known/openid-configuration",
    "/api/.well-known/oauth-authorization-server",
    "/api/.well-known/openid-configuration",
  ],
  mcpRoutes.discoveryHandler
);

app.get(
  [
    "/.well-known/oauth-protected-resource",
    "/api/.well-known/oauth-protected-resource",
  ],
  mcpRoutes.protectedResourceHandler
);

app.post(
  [
    "/register", 
    "/api/register", 
    "/api/mcp/register"
  ], 
  mcpRoutes.registrationHandler
);

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