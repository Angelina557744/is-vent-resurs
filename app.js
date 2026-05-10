const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const multer = require('multer');
const fs = require('fs');

// Подключение всех роутов
const homeRoutes = require('./routes/homeRoutes');
const authRoutes = require('./routes/authRoutes');
const serviceRoutes = require('./routes/serviceRoutes');
const profileRoutes = require('./routes/profileRoutes');
const adminRoutes = require('./routes/adminRoutes');
const apiRoutes = require('./routes/apiRoutes');

dotenv.config();

const app = express();
const db = require('./config/db');

// Проверка подключения к БД
async function testConnection() {
    try {
        await db.query('SELECT 1');
        console.log('Database connected successfully');
    } catch (err) {
        console.error('Database connection failed:', err.message);
    }
}
testConnection();

const PORT = process.env.PORT || 3000;

// Настройка multer для загрузки файлов (общая)
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, 'public', 'img');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, 'cert-' + uniqueSuffix + ext);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/jpg' || file.mimetype === 'image/png') {
            cb(null, true);
        } else {
            cb(new Error('Только JPG и PNG'));
        }
    }
});

// Настройки шаблонизатора
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: 'vent-resurs-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

// Отключаем проверку SSL для GigaChat (временно)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Функция для получения токена GigaChat
async function getGigaChatToken() {
    try {
        const response = await axios.post(
            'https://ngw.devices.sberbank.ru:9443/api/v2/oauth',
            'scope=GIGACHAT_API_PERS',
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json',
                    'RqUID': require('crypto').randomUUID(),
                    'Authorization': `Basic ${process.env.GIGACHAT_AUTH_KEY}`
                },
                httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
            }
        );
        return response.data.access_token;
    } catch (err) {
        console.error('Ошибка получения токена GigaChat:', err.message);
        throw err;
    }
}

// --- MIDDLEWARES ---

// 1. Настройки сайта во все шаблоны
app.use(async (req, res, next) => {
    try {
        const [rows] = await db.query('SELECT setting_key, setting_value FROM site_settings');
        const settings = {};
        rows.forEach(row => {
            settings[row.setting_key] = row.setting_value;
        });
        res.locals.settings = settings; 
        next();
    } catch (err) {
        console.error('Ошибка в Middleware настроек:', err);
        res.locals.settings = {};
        next();
    }
});

// 2. Пользователь во все шаблоны
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});

// ========== ПОДКЛЮЧЕНИЕ ВСЕХ РОУТОВ ==========
app.use('/', homeRoutes);
app.use('/', authRoutes);
app.use('/', serviceRoutes);
app.use('/', profileRoutes);
app.use('/', adminRoutes);
app.use('/', apiRoutes);

// ========== ЗАПУСК СЕРВЕРА ==========
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});