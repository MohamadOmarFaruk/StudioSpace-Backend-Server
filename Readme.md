# 🚀 Assignment 8 – Backend API

A RESTful backend API built with **Node.js, Express.js, and MongoDB**. This project provides structured API endpoints for managing application data with secure authentication, database integration, and efficient server-side operations.

🌐 **Live Server:** https://assingment-8-backend-qejgfz7zd.vercel.app

---

## ✨ Features

- RESTful API architecture using Express.js.
- MongoDB database integration.
- CRUD operations (Create, Read, Update, Delete).
- JWT-based authentication and token verification.
- Secure authentication using JOSE and remote JWKS.
- CORS configuration for frontend integration.
- Environment variable configuration using dotenv.
- Dynamic MongoDB ObjectId handling.
- Serverless deployment with Vercel.

## 🛠️ Technology Stack

| Technology | Purpose |
|---|---|
| Node.js | JavaScript runtime |
| Express.js | Backend framework |
| MongoDB | NoSQL database |
| JOSE | JWT verification |
| CORS | Cross-origin resource sharing |
| dotenv | Environment variable management |
| Vercel | Cloud deployment |

## 🌍 Live Deployment

**Production API URL:**

https://assingment-8-backend-qejgfz7zd.vercel.app

You can use this base URL to access the deployed API endpoints.

## 📡 API Endpoints

Base URL:

```text
https://assingment-8-backend-qejgfz7zd.vercel.app
```

| Method | Endpoint | Description |
|---|---|---|
| GET | `/` | Check server status |
| GET | `/Studios` | Retrieve all studios |
| GET | `/Studios/:id` | Retrieve a specific studio |
| POST | `/Studios` | Create a new studio |
| PATCH | `/Studios/:id` | Update studio information |
| DELETE | `/Studios/:id` | Delete a studio |

*Note: Adjust the endpoint list if your deployed server uses different route names or HTTP methods.*

## ⚙️ Installation & Setup

Follow these steps to run the project locally.

### 1. Clone the Repository

```bash
git clone YOUR_GITHUB_REPOSITORY_URL
```

### 2. Navigate to the Project Directory

```bash
cd assingment-8-backend
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Configure Environment Variables

Create a `.env` file in the root directory:

```env
PORT=5000
MONGODB_URI=your_mongodb_connection_string
CLIENT_URL=http://localhost:3000
```

Add any additional environment variables required by your authentication configuration.

### 5. Start the Development Server

```bash
npm run dev
```

Or:

```bash
node index.js
```

The server will run at:

```text
http://localhost:5000
```

## 🔐 Security

- Sensitive credentials are stored in environment variables.
- JWT tokens are verified before protected operations.
- CORS restricts access to configured frontend origins.
- MongoDB connection credentials are not exposed in source code.

## 📁 Project Structure

```text
assingment-8-backend/
│
├── index.js
├── package.json
├── package-lock.json
├── .env
├── .gitignore
└── README.md
```

*The project structure may vary depending on the final implementation.*

## 🚀 Deployment

This backend is deployed using **Vercel**.

To deploy your own version:

1. Push your project to GitHub.
2. Import the repository into Vercel.
3. Configure the required environment variables.
4. Deploy the project.
5. Use the generated deployment URL for frontend API requests.

## 👨‍💻 Author

**Mohammad Omar Faruk**

Full-Stack Web Developer | MERN Stack Enthusiast

- GitHub: [MohamadOmarFaruk](https://github.com/MohamadOmarFaruk)

---

## ⭐ Support

If you find this project useful, please consider giving the repository a **Star ⭐** on GitHub.

Your support and feedback are always appreciated!

**Thanks for visiting!** 🚀
