import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import multer from "multer";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdf = require("pdf-parse");

import axios from "axios";
import { GoogleGenAI } from "@google/genai";
import "dotenv/config";

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// API Endpoints
app.post("/api/analyze-resume", upload.single("resume"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const dataBuffer = req.file.buffer;
    
    // Using simple pdf-parse v1.1.1 API
    const pdfData = await pdf(dataBuffer);
    res.json({ text: pdfData.text });
  } catch (error: any) {
    console.error("CRITICAL: Error analyzing resume:", error);
    res.status(500).json({ 
      error: "Failed to parse resume", 
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

app.post("/api/fetch-jobs", async (req, res) => {
  const { query, location } = req.body;
  
  try {
    const results = [];
    
    // Attempt Adzuna if configured
    const adzunaId = process.env.ADZUNA_APP_ID;
    const adzunaKey = process.env.ADZUNA_APP_KEY;

    if (adzunaId && adzunaId.trim() !== "" && adzunaKey && adzunaKey.trim() !== "") {
      try {
        const sanitizedQuery = (query || "developer").replace(/[^\w\s]/gi, '');
        const sanitizedLocation = (location || "").replace(/[^\w\s]/gi, '');
        
        console.log(`DEBUG: Adzuna Request - Query: "${sanitizedQuery}", Location: "${sanitizedLocation}"`);
        
        const adzunaRes = await axios.get(`https://api.adzuna.com/v1/api/jobs/gb/search/1`, {
          params: {
            app_id: adzunaId.trim(),
            app_key: adzunaKey.trim(),
            what: sanitizedQuery,
            where: sanitizedLocation,
            results_per_page: 5
          }
        });
        
        if (adzunaRes.data && adzunaRes.data.results) {
          results.push(...adzunaRes.data.results.map((j: any) => ({
            id: j.id,
            title: j.title.replace(/<\/?[^>]+(>|$)/g, ""), // Strip HTML tags
            company: j.company?.display_name,
            location: j.location?.display_name,
            description: j.description.replace(/<\/?[^>]+(>|$)/g, ""), // Strip HTML tags
            url: j.redirect_url,
            source: "Adzuna"
          })));
        }
      } catch (e: any) {
        console.error("Adzuna error details:", e?.response?.data || e.message);
      }
    }

    // Fallback/Mock data if no results (to ensure "production-ready" demo)
    if (results.length === 0) {
      results.push(
        { id: "1", title: "Software Engineer", company: "TechCorp", location: "Remote", description: "Design and build scalable applications using React and Node.js.", source: "Placeholder" },
        { id: "2", title: "Frontend Developer", company: "WebSystems", location: "New York", description: "Expert in Tailwind CSS and modern React frameworks.", source: "Placeholder" },
        { id: "3", title: "Full Stack Engineer", company: "CloudInnovate", location: "San Francisco", description: "Work across the stack with TypeScript, Express, and PostgreSQL.", source: "Placeholder" }
      );
    }

    res.json(results);
  } catch (error: any) {
    res.status(500).json({ error: "Failed to fetch jobs" });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
