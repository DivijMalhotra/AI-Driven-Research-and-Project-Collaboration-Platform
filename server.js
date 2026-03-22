const express = require("express")
const { GoogleGenerativeAI } = require("@google/generative-ai")
const { GoogleAIFileManager } = require("@google/generative-ai/server")
const session = require("express-session")
const multer = require("multer")
const mongoose = require("mongoose")
require("dotenv").config()

// Setup app
const app = express()
const upload = multer({ dest: "/tmp" })  // ✅ fixed for Vercel
app.set("view engine", "ejs")
app.use(express.json())                          // ✅ no need for body-parser
app.use(express.urlencoded({ extended: true }))
app.use(express.static("public"))

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
}))

// MongoDB connection
let isConnected = false;
async function connectDB() {
    if (isConnected) return;
    await mongoose.connect(process.env.MONGODB_URI);
    isConnected = true;
}
connectDB();

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

const User = mongoose.model("User", userSchema)
const Project = mongoose.model("Project", projectSchema)

// AI setup
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY)
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" })

// Routes
app.get("/", async (req, res) => {
    req.session.history = []
    const projects = await Project.find()
    res.render("index", { projects })
})

app.post("/profile", async (req, res) => {
    try {
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

app.get("/collaborators/:interest", async (req, res) => {
    try {
        const interest = req.params.interest.toLowerCase()
        const matches = await User.find({
            researchInterests: { $regex: interest, $options: "i" }
        })
        res.json({ success: true, matches })
    } catch (err) {
        res.status(500).json({ success: false, error: err.message })
    }
})

app.post("/project", async (req, res) => {
    try {
        const { title, description } = req.body
        const project = new Project({ title, description, members: [] })
        await project.save()
        res.json({ success: true, project })
    } catch (err) {
        res.status(500).json({ success: false, error: err.message })
    }
})

app.get("/project/:id", async (req, res) => {
    const project = await Project.findById(req.params.id).populate("messages.sender")
    if (!project) return res.status(404).send("Project not found")
    res.render("project", { project, currentUserId: req.session.userId })
})

app.post("/project/:id/message", async (req, res) => {
    try {
        const project = await Project.findById(req.params.id)
        if (!project) return res.status(404).json({ success: false, error: "Project not found" })

        const senderId = req.session.userId || null
        const { message } = req.body
        project.messages.push({ sender: senderId, text: message })
        await project.save()

        const updated = await Project.findById(req.params.id).populate("messages.sender")
        res.json({ success: true, messages: updated.messages })
    } catch (err) {
        res.status(500).json({ success: false, error: err.message })
    }
})

// ✅ Fixed /converse — parts defined before use
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

        let parts = msg ? [{ text: msg }] : []  // ✅ defined BEFORE any console.log

        console.log("MSG:", msg)
        console.log("FILE:", file)
        console.log("PARTS:", JSON.stringify(parts, null, 2))
        console.log("API KEY:", process.env.GEMINI_API_KEY ? "EXISTS" : "MISSING")

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
        const reply = result?.response?.candidates?.[0]?.content?.parts?.[0]?.text || "No response"

        req.session.history.push({ role: "user", parts })
        req.session.history.push({ role: "model", parts: [{ text: reply }] })

        res.json({ success: true, reply })
    } catch (error) {
        console.error("❌ FULL ERROR:", error)
        console.error("❌ MESSAGE:", error.message)
        console.error("❌ STACK:", error.stack)
        res.status(500).json({ success: false, reply: "Error: Could not generate a response." })
    }
})

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`)
})