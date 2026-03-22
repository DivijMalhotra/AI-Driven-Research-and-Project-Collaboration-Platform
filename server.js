const express = require("express")
const { GoogleGenerativeAI } = require("@google/generative-ai")
const { GoogleAIFileManager } = require("@google/generative-ai/server")
const session = require("express-session")
const multer = require("multer")
const mongoose = require("mongoose")
require("dotenv").config()

const app = express()
const upload = multer({ dest: "/tmp" })

app.set("view engine", "ejs")
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(express.static("public"))

app.use(session({
    secret: process.env.SESSION_SECRET || "secret",
    resave: false,
    saveUninitialized: true,
}))

// ✅ FIXED MongoDB connection (Vercel-safe)
let cached = global.mongoose || { conn: null, promise: null }

async function connectDB() {
    if (cached.conn) return cached.conn

    if (!cached.promise) {
        cached.promise = mongoose.connect(process.env.MONGODB_URI, {
            bufferCommands: false,
        }).then(m => m)
    }

    cached.conn = await cached.promise
    return cached.conn
}

// Schemas
const userSchema = new mongoose.Schema({
    name: String,
    role: { type: String, enum: ["student", "faculty"] },
    department: String,
    skills: [String],
    researchInterests: [String],
    uploadedFiles: [String]
})

const projectSchema = new mongoose.Schema({
    title: String,
    description: String,
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    files: [String],
    messages: [{
        sender: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        text: String,
        createdAt: { type: Date, default: Date.now }
    }]
})

const User = mongoose.models.User || mongoose.model("User", userSchema)
const Project = mongoose.models.Project || mongoose.model("Project", projectSchema)

// AI setup
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY)
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" })

// ================= ROUTES =================

// Home
app.get("/", async (req, res) => {
    await connectDB()

    req.session.history = []
    const projects = await Project.find()
    res.render("index", { projects })
})

// Create Profile
app.post("/profile", async (req, res) => {
    try {
        await connectDB()

        const { name, role, department, skills, researchInterests } = req.body

        const user = new User({
            name,
            role,
            department,
            skills: skills.split(",").map(s => s.trim()),
            researchInterests: researchInterests.split(",").map(r => r.trim())
        })

        await user.save()
        res.json({ success: true, user })

    } catch (err) {
        res.status(500).json({ success: false, error: err.message })
    }
})

// Find collaborators
app.get("/collaborators/:interest", async (req, res) => {
    try {
        await connectDB()

        const interest = req.params.interest.toLowerCase()
        const matches = await User.find({
            researchInterests: { $regex: interest, $options: "i" }
        })

        res.json({ success: true, matches })

    } catch (err) {
        res.status(500).json({ success: false, error: err.message })
    }
})

// Create project
app.post("/project", async (req, res) => {
    try {
        await connectDB()

        const { title, description } = req.body
        const project = new Project({ title, description, members: [] })

        await project.save()
        res.json({ success: true, project })

    } catch (err) {
        res.status(500).json({ success: false, error: err.message })
    }
})

// Get project
app.get("/project/:id", async (req, res) => {
    await connectDB()

    const project = await Project.findById(req.params.id)
        .populate("messages.sender")

    if (!project) return res.status(404).send("Project not found")

    res.render("project", {
        project,
        currentUserId: req.session.userId
    })
})

// Send message
app.post("/project/:id/message", async (req, res) => {
    try {
        await connectDB()

        const project = await Project.findById(req.params.id)
        if (!project) {
            return res.status(404).json({ success: false, error: "Project not found" })
        }

        const senderId = req.session.userId || null
        const { message } = req.body

        project.messages.push({ sender: senderId, text: message })
        await project.save()

        const updated = await Project.findById(req.params.id)
            .populate("messages.sender")

        res.json({ success: true, messages: updated.messages })

    } catch (err) {
        res.status(500).json({ success: false, error: err.message })
    }
})

// AI Converse
app.post("/converse", upload.single("file"), async (req, res) => {
    const msg = req.body.message
    const file = req.file

    if (!msg && !file) {
        return res.status(400).json({ success: false, reply: "Empty input" })
    }

    try {
        if (!req.session.history) {
            req.session.history = []
        }

        let parts = msg ? [{ text: msg }] : []

        if (file) {
            const uploadResult = await fileManager.uploadFile(file.path, {
                mimeType: file.mimetype,
                displayName: file.originalname,
            })

            parts.push({
                fileData: {
                    fileUri: uploadResult.file.uri,
                    mimeType: file.mimetype,
                }
            })
        }

        const chat = model.startChat({ history: req.session.history })
        const result = await chat.sendMessage(parts)

        const reply =
            result?.response?.candidates?.[0]?.content?.parts?.[0]?.text ||
            "No response"

        req.session.history.push({ role: "user", parts })
        req.session.history.push({ role: "model", parts: [{ text: reply }] })

        res.json({ success: true, reply })

    } catch (error) {
        console.error(error)
        res.status(500).json({
            success: false,
            reply: "Error: Could not generate a response."
        })
    }
})

// Start server (for local only)
const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`)
})