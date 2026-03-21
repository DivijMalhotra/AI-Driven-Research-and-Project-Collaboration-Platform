// ================= Chat =================
const form = document.getElementById("form")
const input = document.getElementById("input")
const messagesDiv = document.getElementById("messages")
const typingDiv = document.getElementById("typing")
const fileInput = document.getElementById("file-upload")

form?.addEventListener("submit", async (e) => {
  e.preventDefault()

  const msg = input.value.trim()
  const file = fileInput.files[0]
  if (!msg && !file) return

  const formData = new FormData()
  formData.append("message", msg)
  if (file) formData.append("file", file)

  typingDiv.style.display = "inline-block"

  if (file) addMessage("user", null, file)
  else addMessage("user", msg)

  input.value = ""
  fileInput.value = ""

  try {
    const res = await fetch("/converse", { method: "POST", body: formData })
    const data = await res.json()

    typingDiv.style.display = "none"

    if (data.success) {
      addMessage("ai", data.reply)
    } else {
      addMessage("ai", "⚠️ " + (data.error || data.reply))
    }
  } catch (err) {
    typingDiv.style.display = "none"
    addMessage("ai", "❌ Network/Server error: " + err.message)
  }
})

function addMessage(role, text, file = null) {
  const div = document.createElement("div")
  div.className = `message ${role}`

  if (file) {
    let filePreview = ""
    if (file.type.startsWith("image/")) {
      filePreview = `<img src="${URL.createObjectURL(file)}" alt="${file.name}" class="file-preview" />`
    } else if (file.type === "application/pdf") {
      filePreview = `<div class="file-icon">📕</div>`
    } else if (file.type.includes("word")) {
      filePreview = `<div class="file-icon">📘</div>`
    } else if (file.type.includes("excel")) {
      filePreview = `<div class="file-icon">📊</div>`
    } else {
      filePreview = `<div class="file-icon">📁</div>`
    }

    div.innerHTML = `
      <div class="file-card">
        ${filePreview}
        <div class="file-info">
          <span class="file-name">${file.name}</span>
          <a href="${URL.createObjectURL(file)}" target="_blank" download="${file.name}">
            <button class="download-btn">⬇ Download</button>
          </a>
        </div>
      </div>
    `
  } else if (role === 'ai') {
    div.innerHTML = `<span>${marked.parse(text || "")}</span>`
  } else {
    div.innerHTML = `<span>${text}</span>`
  }

  messagesDiv?.appendChild(div)
  messagesDiv.scrollTop = messagesDiv.scrollHeight
}

// ================= Profile =================
const profileForm = document.getElementById("profile-form")
if (profileForm) {
  profileForm.addEventListener("submit", async (e) => {
    e.preventDefault()
    const formData = new FormData(profileForm)
    const body = {}
    formData.forEach((v, k) => body[k] = v)

    try {
      const res = await fetch("/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      })
      const data = await res.json()

      document.getElementById("profile-result").innerHTML =
        data.success ? `✅ Profile saved for ${data.user.name}` : `❌ ${data.error}`
    } catch (err) {
      document.getElementById("profile-result").innerHTML =
        `❌ Network/Server error: ${err.message}`
    }
  })
}

// ================= Collaborators =================
const collabForm = document.getElementById("collab-form")
if (collabForm) {
  collabForm.addEventListener("submit", async (e) => {
    e.preventDefault()
    const interest = document.getElementById("interest").value
    try {
      const res = await fetch(`/collaborators/${interest}`)
      const data = await res.json()

      const results = document.getElementById("collab-results")
      results.innerHTML = ""

      if (data.success && data.matches.length) {
        data.matches.forEach(u => {
          const li = document.createElement("li")
          li.textContent = `${u.name} (${u.role}, ${u.department}) - Interests: ${u.researchInterests.join(", ")}`
          results.appendChild(li)
        })
      } else {
        results.innerHTML = "<li>No collaborators found.</li>"
      }
    } catch (err) {
      document.getElementById("collab-results").innerHTML =
        `<li>❌ Error: ${err.message}</li>`
    }
  })
}

// ================= Project Creation =================
const projectForm = document.getElementById("project-form")
if (projectForm) {
  projectForm.addEventListener("submit", async (e) => {
    e.preventDefault()
    const formData = new FormData(projectForm)
    const body = {}
    formData.forEach((v, k) => body[k] = v)

    try {
      const res = await fetch("/project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      })
      const data = await res.json()

      if (data.success) {
        alert("✅ Project created! Refresh to see in list.")
      } else {
        alert("❌ " + data.error)
      }
    } catch (err) {
      alert("❌ Network/Server error: " + err.message)
    }
  })
}

// ================= Project Chat =================
// ================= Project Chat =================
const projectChatForm = document.getElementById("project-form-chat")
if (projectChatForm) {
  projectChatForm.addEventListener("submit", async (e) => {
    e.preventDefault()
    const projectId = projectChatForm.dataset.projectId
    const input = document.getElementById("project-input")
    const message = input.value.trim()
    if (!message) return

    try {
      const res = await fetch(`/project/${projectId}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message })
      })
      const data = await res.json()

      const msgDiv = document.getElementById("project-messages")
      msgDiv.innerHTML = ""

      if (data.success) {
        data.messages.forEach(m => {
          const div = document.createElement("div")
          div.className = "chat-message " + 
            (m.sender?._id === window.currentUserId ? "sent" : "received")

          div.innerHTML = `
            <div class="chat-sender">${m.sender?.name || "Unknown"}</div>
            <div class="chat-bubble">${m.text}</div>
          `
          msgDiv.appendChild(div)
        })
      } else {
        msgDiv.innerHTML = `<div class="chat-message received"><div class="chat-bubble">⚠️ ${data.error}</div></div>`
      }

      msgDiv.scrollTop = msgDiv.scrollHeight
      input.value = ""
    } catch (err) {
      const msgDiv = document.getElementById("project-messages")
      msgDiv.innerHTML += `<div class="chat-message received"><div class="chat-bubble">❌ ${err.message}</div></div>`
    }
  })
}

