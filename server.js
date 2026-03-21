const express = require("express")
const bodyParser = require("body-parser")
const { GoogleGenerativeAI } = require("@google/generative-ai")
const { GoogleAIFileManager } = require("@google/generative-ai/server")
const session = require("express-session")
const multer = require("multer")
const mongoose = require("mongoose")
require("dotenv").config()

// Setup app
const app = express()
const upload = multer({ dest: "uploads" })
app.set("view engine", "ejs")
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))
app.use(express.static("public"))

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
}))

// MongoDB connection
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
}).then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB error:", err))

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
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" })

// Routes
// Homepage
app.get("/", async (req, res) => {
    req.session.history = [] // reset history on refresh
    const projects = await Project.find()
    res.render("index", { projects })
})

// Create profile
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

// Find collaborators
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

// Create project
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

// View project page
app.get("/project/:id", async (req, res) => {
  const project = await Project.findById(req.params.id).populate("messages.sender")
  if (!project) return res.status(404).send("Project not found")

  res.render("project", { project, currentUserId: req.session.userId })
})


// Send message in project
app.post("/project/:id/message", async (req, res) => {
  try {
    const project = await Project.findById(req.params.id).populate("messages.sender")
    if (!project) return res.status(404).json({ success: false, error: "Project not found" })

    // simulate logged-in user (later hook this to real auth)
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


// AI Converse route
app.post("/converse", upload.single("file"), async (req, res) => {
    const msg = req.body.message
    const file = req.file

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
        const reply = result.response.text()

        req.session.history.push({ role: "user", parts })
        req.session.history.push({ role: "model", parts: [{ text: reply }] })

        res.json({ success: true, reply })
    } catch (error) {
        console.error("Gemini API error:", error)
        res.status(500).json({ success: false, reply: "Error: Could not generate a response." })
    }
})

app.listen(process.env.PORT, () => {
    console.log(`🚀 Server running on port ${process.env.PORT}`)
})
