const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const multer = require('multer');
const fs = require('fs');

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
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/jpg' || file.mimetype === 'image/png') {
            cb(null, true);
        } else {
            cb(new Error('Только JPG и PNG'));
        }
    }
});
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: 'vent-resurs-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

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

// --- ФУНКЦИИ ПРОВЕРКИ ДОСТУПА ---

function isAdmin(req, res, next) {
    if (req.session.user && req.session.user.role === 'admin') {
        return next();
    }
    res.status(403).send('Доступ только для администраторов');
}

function isAuth(req, res, next) {
    if (req.session && req.session.user) {
        return next();
    }
    res.redirect('/login');
}

// --- ПУБЛИЧНЫЕ МАРШРУТЫ ---

app.get('/', async (req, res) => {
    try {
        const [slides] = await db.query('SELECT * FROM home_slider ORDER BY order_index ASC');
        const [advantages] = await db.query('SELECT * FROM advantages ORDER BY order_index ASC');
        const [reps] = await db.query('SELECT * FROM partners WHERE partner_type = "representative"');
        const [clients] = await db.query('SELECT * FROM partners WHERE partner_type = "client"');
        
        res.render('index', { 
            title: 'Главная | ВентРесурс',
            slides, advantages, reps, clients
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка загрузки главной страницы');
    }
});

app.get('/services', async (req, res) => {
    try {
        const [services] = await db.query('SELECT * FROM services');
        res.render('services', { title: 'Услуги под ключ | ВентРесурс', services });
    } catch (err) {
        res.status(500).send('Ошибка загрузки услуг');
    }
});

app.get('/projects', async (req, res) => {
    try {
        const [projects] = await db.query('SELECT * FROM projects ORDER BY year DESC');
        res.render('projects', { title: 'Наши работы | ВентРесурс', projects });
    } catch (err) {
        res.status(500).send('Ошибка портфолио');
    }
});

app.get('/contacts', (req, res) => {
    res.render('contacts', { title: 'Контакты | ВентРесурс' });
});

// --- АВТОРИЗАЦИЯ ---

app.get('/register', (req, res) => {
    res.render('register', { title: 'Регистрация | ВентРесурс' });
});

app.post('/register', async (req, res) => {
    const { username, full_name, email, password } = req.body;
    try {
        const [existing] = await db.query('SELECT id FROM users WHERE username = ? OR email = ?', [username, email]);
        if (existing.length > 0) return res.render('register', { title: 'Регистрация', error: 'Данные заняты' });

        const hashedPassword = await bcrypt.hash(password, 10);
        await db.query('INSERT INTO users (username, full_name, email, password, role) VALUES (?, ?, ?, ?, ?)', 
            [username, full_name, email, hashedPassword, 'user']);
        res.redirect('/login');
    } catch (err) {
        res.status(500).render('register', { title: 'Регистрация', error: 'Ошибка регистрации' });
    }
});

app.get('/login', (req, res) => {
    res.render('login', { title: 'Вход | ВентРесурс' });
});

app.post('/login', async (req, res) => {
    const { login, password } = req.body;
    try {
        const [users] = await db.query('SELECT * FROM users WHERE username = ?', [login]);
        if (users.length === 0) return res.render('login', { title: 'Вход', error: 'Пользователь не найден' });

        const user = users[0];
        if (await bcrypt.compare(password, user.password)) {
            req.session.user = { id: user.id, username: user.username, full_name: user.full_name, role: user.role };
            req.session.save(() => res.redirect(user.role === 'admin' ? '/admin' : '/profile'));
        } else {
            res.render('login', { title: 'Вход', error: 'Неверный пароль' });
        }
    } catch (err) {
        res.status(500).send('Ошибка входа');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- ЛИЧНЫЙ КАБИНЕТ ---

app.get('/profile', isAuth, async (req, res) => {
    try {
const userId = req.session.user.id;
        const [[userData]] = await db.query('SELECT email FROM users WHERE id = ?', [userId]);

        if (!userData) {
             return res.redirect('/logout'); // Или обработка ошибки
        }

        const [quizResults] = await db.query(
            'SELECT * FROM quiz_results WHERE user_id = ? ORDER BY created_at DESC', 
            [userId]
        );

        // Ищем вопросы из формы контактов, где email совпадает с email пользователя
        const [userMessages] = await db.query(
            'SELECT * FROM contact_messages WHERE email = ? AND admin_answer IS NOT NULL ORDER BY created_at DESC',
            [userData.email]
        );

        res.render('profile', { 
            title: 'Личный кабинет | ВентРесурс',
            user: req.session.user,
            quizResults: quizResults,
            notifications: userMessages // Передаем ответы как уведомления
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка при загрузке профиля');
    }
});

app.get('/profile/quiz', isAuth, (req, res) => {
    res.render('quiz', { title: 'Подбор системы вентиляции' });
});


// Обновление профиля пользователя
app.post('/api/profile/update', isAuth, async (req, res) => {
    const userId = req.session.user.id;
    const { email, phone, password } = req.body;
    
    try {
        // Проверяем, не занят ли email другим пользователем
        if (email) {
            const [existing] = await db.query(
                'SELECT id FROM users WHERE email = ? AND id != ?', 
                [email, userId]
            );
            if (existing.length > 0) {
                return res.json({ success: false, error: 'Этот email уже используется' });
            }
        }
        
        let query = 'UPDATE users SET email = ?, phone = ?';
        const params = [email, phone || null];
        
        // Если ввели новый пароль - обновляем
        if (password && password.length >= 4) {
            const hashedPassword = await bcrypt.hash(password, 10);
            query += ', password = ?';
            params.push(hashedPassword);
        }
        
        query += ' WHERE id = ?';
        params.push(userId);
        
        await db.query(query, params);
        
        // Обновляем email в сессии
        req.session.user.email = email;
        
        res.json({ success: true, message: 'Профиль успешно обновлен' });
        
    } catch (err) {
        console.error('Ошибка обновления профиля:', err);
        res.json({ success: false, error: 'Ошибка при обновлении профиля' });
    }
});

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
                httpsAgent: new (require('https').Agent)({  
                    rejectUnauthorized: false
                })
            }
        );
        
        console.log('✅ Токен GigaChat получен');
        return response.data.access_token;
    } catch (err) {
        console.error('❌ Ошибка получения токена GigaChat:');
        if (err.response) {
            console.error('Статус:', err.response.status);
            console.error('Данные:', err.response.data);
        } else {
            console.error('Ошибка:', err.message);
        }
        throw err;
    }
}


// Функция для классификации сообщения через GigaChat
async function classifyMessageWithGigaChat(message) {
    const https = require('https');
    const agent = new https.Agent({ rejectUnauthorized: false });
    
    const prompt = `Классифицируй вопрос пользователя в одну из категорий:
- Ремонт (вопросы о ремонте вентиляции, замене оборудования)
- Проектирование (вопросы о расчетах, проектной документации)
- Сотрудничество (вопросы о партнерстве, дилерстве)
- Цена (вопросы о стоимости, смете, оплате)
- Общее (не подходит ни под одну категорию)

Вопрос: "${message.substring(0, 500)}"

Ответь ТОЛЬКО названием категории (одним словом из списка: Ремонт, Проектирование, Сотрудничество, Цена, Общее).`;

    try {
        console.log('🔄 Отправляем запрос на классификацию в GigaChat...');
        
        const token = await getGigaChatToken();
        
        const response = await axios.post(
            'https://gigachat.devices.sberbank.ru/api/v1/chat/completions',
            {
                model: "GigaChat",
                messages: [
                    {
                        role: "system",
                        content: "Ты классификатор сообщений. Отвечай только названием категории: Ремонт, Проектирование, Сотрудничество, Цена, Общее. Никаких других слов и знаков препинания."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                temperature: 0.1,
                max_tokens: 20,
                stream: false,
                update_interval: 0
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                timeout: 10000,
                httpsAgent: agent
            }
        );
        
        let category = response.data.choices[0].message.content.trim();
        
        // Валидация категории
        const validCategories = ['Ремонт', 'Проектирование', 'Сотрудничество', 'Цена', 'Общее'];
        if (!validCategories.includes(category)) {
            console.log(`⚠️ Нераспознанная категория: ${category}, устанавливаем 'Общее'`);
            category = 'Общее';
        }
        
        console.log(`✅ Классификация успешна: ${category}`);
        return category;
        
    } catch (err) {
        console.error('❌ Ошибка классификации через GigaChat:');
        if (err.response) {
            console.error('Статус:', err.response.status);
            console.error('Данные:', JSON.stringify(err.response.data, null, 2));
        } else {
            console.error('Ошибка:', err.message);
        }
        return 'Общее';
    }
}


app.post('/api/quiz-save', isAuth, async (req, res) => {
    const https = require('https');
    const agent = new https.Agent({ rejectUnauthorized: false });
    
    const { 
        building_type, 
        area, 
        people_count, 
        budget_range, 
        industry,
        ceiling_height,
        automation 
    } = req.body;
    
    const userId = req.session.user.id;
    
    // Рассчитываем примерную цену
    let estimated_price = parseFloat(area) * 5000;
    if (budget_range === 'Премиум') estimated_price *= 1.5;
    if (budget_range === 'Стандарт') estimated_price *= 1.2;
    if (building_type === 'Производство') estimated_price *= 1.3;
    
    // Улучшенный промпт
    const prompt = `Ты профессиональный инженер-консультант компании "ВентРесурс".

Данные клиента после квиза:
- Объект: ${building_type}
- Сфера: ${industry || 'не указана'}  
- Площадь: ${area} м²
- Высота: ${ceiling_height || '3'} м
- Людей: ${people_count}
- Бюджет: ${budget_range}
- Автоматизация: ${automation === 'yes' ? 'нужна' : 'не нужна'}
- Цена: ${estimated_price.toLocaleString()} руб.

Напиши клиенту ответ от "ВентРесурс" по схеме:
1. Приветствие ("Здравствуйте! Спасибо за обращение в ВентРесурс")
2. Обоснование цены (2-3 фактора, почему так)
3. Что входит в стоимость
4. Полезный совет
5. Предложение связаться

Ответ должен быть теплым, профессиональным, 4-6 предложений. Только русский язык.`;

    let recommendation = `Здравствуйте! Спасибо за обращение в компанию "ВентРесурс"!

Предварительная стоимость системы ${building_type.toLowerCase()} для вашего объекта площадью ${area} м² составляет ${estimated_price.toLocaleString()} рублей.

Эта цена включает: проектирование, оборудование (${budget_range} класс), доставку, монтаж и пусконаладку.

Для получения точного коммерческого предложения, пожалуйста, оставьте заявку на сайте или позвоните нам. Наш инженер свяжется с вами в ближайшее время!

С уважением, команда ВентРесурс.`;

    try {
        console.log('🔄 Получаем токен GigaChat...');
        const token = await getGigaChatToken();
        
        console.log('🔄 Отправляем запрос к GigaChat...');
        const response = await axios.post(
            'https://gigachat.devices.sberbank.ru/api/v1/chat/completions',
            {
                model: "GigaChat",
                messages: [
                    {
                        role: "system",
                        content: "Ты дружелюбный консультант компании ВентРесурс. Отвечай тепло, профессионально, кратко. Используй обращение 'вы'. Всегда предлагай связаться для точного расчета."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                temperature: 0.8,
                max_tokens: 400,
                stream: false,
                update_interval: 0
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                timeout: 20000,
                httpsAgent: agent
            }
        );
        
        if (response.data && response.data.choices && response.data.choices[0]) {
            recommendation = response.data.choices[0].message.content;
            console.log('✅ Ответ получен от GigaChat');
        }
        
    } catch (err) {
        console.error('❌ ОШИБКА GigaChat, используем стандартный ответ');
        // recommendation уже содержит запасной вариант
    }
    
    // Сохраняем результат в БД
    try {
        await db.query(
            `INSERT INTO quiz_results 
            (user_id, building_type, area, people_count, budget_range, estimated_price, ai_recommendation, industry, ceiling_height) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, building_type, area, people_count, budget_range, estimated_price, recommendation, industry || null, ceiling_height || null]
        );
        
        console.log('✅ Результат сохранен в БД');
        
    } catch (dbErr) {
        console.error('❌ Ошибка сохранения в БД:', dbErr);
    }
    
    res.json({ success: true, recommendation: recommendation });
});

app.post('/callback', async (req, res) => {
    const { name, phone } = req.body;
    try {
        await db.query('INSERT INTO callbacks (name, phone) VALUES (?, ?)', [name, phone]);
        res.status(200).json({ message: 'success' });
    } catch (error) {
        res.status(500).json({ message: 'error' });
    }
});

// --- АДМИН-ПАНЕЛЬ (ГРУППИРОВКА) ---

app.get('/admin', isAdmin, async (req, res) => {
    try {
        // Безопасное получение счетчиков
        const [sRes] = await db.query('SELECT COUNT(*) as count FROM services');
        const [cRes] = await db.query('SELECT COUNT(*) as count FROM callbacks');
        const [pRes] = await db.query('SELECT COUNT(*) as count FROM projects');
        const [uRes] = await db.query('SELECT COUNT(*) as count FROM users');
        const [mRes] = await db.query('SELECT COUNT(*) as count FROM contact_messages');

        // Безопасный запрос квизов (LEFT JOIN не даст ошибку, если пользователь удален)
        const [recentQuiz] = await db.query(`
            SELECT qr.*, u.full_name, u.phone 
            FROM quiz_results qr 
            LEFT JOIN users u ON qr.user_id = u.id 
            ORDER BY qr.created_at DESC LIMIT 5
        `);

        res.render('admin/dashboard', {
            title: 'Панель управления | ВентРесурс',
            user: req.session.user,
            stats: {
                services: sRes[0]?.count || 0,
                callbacks: cRes[0]?.count || 0,
                projects: pRes[0]?.count || 0,
                users: uRes[0]?.count || 0,
                messages: mRes[0]?.count || 0
            },
            recentQuiz: recentQuiz || [] // Гарантируем, что это массив
        });
    } catch (err) {
        console.error("КРИТИЧЕСКАЯ ОШИБКА АДМИНКИ:", err);
        // Выводим текст ошибки прямо на экран, чтобы вы поняли, какой таблицы не хватает
        res.status(500).send(`Ошибка базы данных: ${err.message}`);
    }
});

// ТОТ САМЫЙ МАРШРУТ (ИСПРАВЛЕННЫЙ)
app.get('/admin/callbacks', isAdmin, async (req, res) => {
    try {
        const [callbacks] = await db.query('SELECT * FROM callbacks ORDER BY created_at DESC');
        res.render('admin/callbacks', { 
            title: 'Заявки на звонок | Админ-панель',
            callbacks: callbacks || []
            // settings и user НЕ НУЖНО передавать, они в res.locals
        });
    } catch (error) {
        res.status(500).send('Ошибка загрузки заявок');
    }
});

app.get('/admin/services', isAdmin, async (req, res) => {
    try {
        const [services] = await db.query('SELECT * FROM services');
        res.render('admin/services', { title: 'Управление услугами', services });
    } catch (err) {
        res.status(500).send('Ошибка услуг');
    }
});

app.post('/admin/services/add', isAdmin, async (req, res) => {
    const { title, description, price, image_url } = req.body;
    try {
        await db.query('INSERT INTO services (title, description, price, image_url) VALUES (?, ?, ?, ?)', [title, description, price, image_url]);
        res.redirect('/admin/services');
    } catch (err) {
        res.status(500).send('Ошибка добавления');
    }
});

app.post('/admin/services/delete/:id', isAdmin, async (req, res) => {
    try {
        await db.query('DELETE FROM services WHERE id = ?', [req.params.id]);
        res.redirect('/admin/services');
    } catch (err) {
        res.status(500).send('Ошибка удаления');
    }
});

app.get('/admin/home', isAdmin, async (req, res) => {
    try {
        const [texts] = await db.query('SELECT * FROM site_settings WHERE category IN ("hero", "about", "geo")');
        const [slides] = await db.query('SELECT * FROM home_slider ORDER BY order_index');
        const [advantages] = await db.query('SELECT * FROM advantages ORDER BY order_index');
        const [partners] = await db.query('SELECT * FROM partners');
        res.render('admin/home_edit', { title: 'Управление главной', texts, slides, advantages, partners });
    } catch (err) {
        res.status(500).send('Ошибка');
    }
});

app.get('/admin/projects', isAdmin, async (req, res) => {
    try {
        const [projects] = await db.query('SELECT * FROM projects ORDER BY year DESC');
        res.render('admin/projects_edit', { title: 'Управление проектами', projects });
    } catch (err) {
        res.status(500).send('Ошибка');
    }
});

app.post('/admin/projects/add', isAdmin, async (req, res) => {
    const { year, title, object_type, image_url } = req.body;
    const slug = `projects-${year}-${Date.now()}`; 
    try {
        await db.query('INSERT INTO projects (year, title, object_type, image_url, slug) VALUES (?, ?, ?, ?, ?)', [year, title, object_type, image_url || 'project-placeholder.jpg', slug]);
        res.redirect('/admin/projects?success=1');
    } catch (err) {
        res.status(500).send('Ошибка');
    }
});

app.post('/admin/projects/delete/:id', isAdmin, async (req, res) => {
    try {
        await db.query('DELETE FROM projects WHERE id = ?', [req.params.id]);
        res.redirect('/admin/projects?deleted=1');
    } catch (err) {
        res.status(500).send('Ошибка');
    }
});

app.get('/admin/contacts', isAdmin, async (req, res) => {
    try {
        const [texts] = await db.query('SELECT * FROM site_settings WHERE category = "contacts"');
        res.render('admin/contacts_edit', { title: 'Управление контактами', texts });
    } catch (err) {
        res.status(500).send('Ошибка');
    }
});

app.post('/admin/contacts/update', isAdmin, async (req, res) => {
    const updates = req.body;
    try {
        for (let key in updates) {
            await db.query('UPDATE site_settings SET setting_value = ? WHERE setting_key = ?', [updates[key], key]);
        }
        res.redirect('/admin/contacts?success=1');
    } catch (err) {
        res.status(500).send('Ошибка');
    }
});

app.get('/admin/content', isAdmin, async (req, res) => {
    const [settings] = await db.query('SELECT * FROM site_settings');
    res.render('admin/content', { title: 'Управление текстами', settings });
});

app.post('/admin/content/update', isAdmin, async (req, res) => {
    const updates = req.body;
    try {
        for (let key in updates) {
            await db.query('UPDATE site_settings SET setting_value = ? WHERE setting_key = ?', [updates[key], key]);
        }
        res.redirect('/admin/content');
    } catch (err) {
        res.status(500).send('Ошибка');
    }
});

app.get('/reset-admin-password', async (req, res) => {
    try {
        const hashedPassword = await bcrypt.hash('adm88@VENT556', 10);
        await db.query('UPDATE users SET password = ? WHERE username = ?', [hashedPassword, 'admin']);
        res.send('Пароль обновлен!');
    } catch (err) {
        res.status(500).send('Ошибка');
    }
});

app.post('/admin/callbacks/update-status/:id', isAdmin, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    try {
        await db.query('UPDATE callbacks SET status = ? WHERE id = ?', [status, id]);
        
        res.redirect('/admin/callbacks');
    } catch (error) {
        console.error('Ошибка обновления статуса:', error);
        res.status(500).send('Ошибка сервера при обновлении статуса');
    }
});

// Обработка формы контактов с классификацией через GigaChat
app.post('/api/contact-message', async (req, res) => {
    const { name, email, phone, message } = req.body;
    
    // Валидация обязательных полей
    if (!name || !email || !message) {
        console.error('Ошибка: Не все обязательные поля заполнены');
        return res.redirect('/contacts?error=1');
    }
    
    console.log('--- НОВОЕ СООБЩЕНИЕ ОТ ПОЛЬЗОВАТЕЛЯ ---');
    console.log(`От: ${name} (${email})`);
    console.log(`Сообщение: ${message.substring(0, 100)}...`);
    
    let category = 'Общее';
    
    // Вызываем классификацию через GigaChat
    try {
        category = await classifyMessageWithGigaChat(message);
        console.log(`📊 Категория определена: ${category}`);
    } catch (err) {
        console.error('❌ Классификация не удалась, используем категорию по умолчанию');
        category = 'Общее';
    }
    
    // Сохраняем в базу данных
    try {
        await db.query(
            'INSERT INTO contact_messages (name, email, phone, message, category, status) VALUES (?, ?, ?, ?, ?, ?)',
            [name, email, phone, message, category, 'new']
        );
        console.log('💾 Сообщение сохранено в базу данных');
        res.redirect('/contacts?success=1');
        
    } catch (dbErr) {
        console.error('❌ Ошибка сохранения в БД:', dbErr.message);
        res.redirect('/contacts?error=1');
    }
});

app.get('/admin/messages', isAdmin, async (req, res) => {
    try {
        const [messages] = await db.query('SELECT * FROM contact_messages ORDER BY created_at DESC');
        res.render('admin/messages', { 
            title: 'Вопросы пользователей | Админ',
            messages: messages || [] 
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Ошибка загрузки сообщений');
    }
});

app.post('/admin/messages/update-status/:id', isAdmin, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    try {
        await db.query('UPDATE contact_messages SET status = ? WHERE id = ?', [status, id]);
        res.redirect('/admin/messages');
    } catch (error) {
        res.status(500).send('Ошибка при обновлении статуса');
    }
});


app.post('/admin/messages/answer/:id', isAdmin, async (req, res) => {
    const { id } = req.params;
    const { admin_answer } = req.body;
    try {
      
        await db.query(
            'UPDATE contact_messages SET admin_answer = ?, status = "completed" WHERE id = ?', 
            [admin_answer, id]
        );
        res.redirect('/admin/messages?success=answer');
    } catch (error) {
        console.error(error);
        res.status(500).send('Ошибка при сохранении ответа');
    }
});

app.get('/api/certificates', async (req, res) => {
    try {
        const [certificates] = await db.query(
            'SELECT * FROM certificates WHERE is_active = 1 ORDER BY order_index ASC'
        );
        res.json(certificates);
    } catch (err) {
        console.error('Ошибка получения сертификатов:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Админ: страница управления сертификатами
app.get('/admin/certificates', isAdmin, async (req, res) => {
    try {
        const [certificates] = await db.query(
            'SELECT * FROM certificates ORDER BY order_index ASC'
        );
        res.render('admin/certificates', {
            title: 'Сертификаты и лицензии | Админ',
            certificates: certificates,
            success: req.query.success,
            error: req.query.error
        });
    } catch (err) {
        console.error('Ошибка:', err);
        res.status(500).send('Ошибка загрузки');
    }
});

// Админ: добавление сертификата с загрузкой файла
app.post('/admin/certificates/add', isAdmin, upload.single('image'), async (req, res) => {
    const { title, is_active } = req.body;
    
    if (!title || !req.file) {
        return res.redirect('/admin/certificates?error=1');
    }
    
    try {
        await db.query(
            'INSERT INTO certificates (title, image_url, is_active) VALUES (?, ?, ?)',
            [title, req.file.filename, is_active === 'on' ? 1 : 0]
        );
        res.redirect('/admin/certificates?success=1');
    } catch (err) {
        console.error('Ошибка добавления:', err);
        res.redirect('/admin/certificates?error=1');
    }
});

// Админ: обновление сертификата
app.post('/admin/certificates/update/:id', isAdmin, upload.single('image'), async (req, res) => {
    const { id } = req.params;
    const { title, is_active, existing_image } = req.body;
    
    let image_url = existing_image;
    
    // Если загружена новая картинка
    if (req.file) {
        // Удаляем старую картинку
        if (existing_image) {
            const oldPath = path.join(__dirname, 'public', 'img', existing_image);
            if (fs.existsSync(oldPath)) {
                fs.unlinkSync(oldPath);
            }
        }
        image_url = req.file.filename;
    }
    
    try {
        await db.query(
            'UPDATE certificates SET title = ?, image_url = ?, is_active = ? WHERE id = ?',
            [title, image_url, is_active === 'on' ? 1 : 0, id]
        );
        res.redirect('/admin/certificates?success=2');
    } catch (err) {
        console.error('Ошибка обновления:', err);
        res.redirect('/admin/certificates?error=2');
    }
});

// Админ: удаление сертификата
app.post('/admin/certificates/delete/:id', isAdmin, async (req, res) => {
    const { id } = req.params;
    
    try {
        // Получаем имя файла перед удалением
        const [cert] = await db.query('SELECT image_url FROM certificates WHERE id = ?', [id]);
        
        // Удаляем файл из папки
        if (cert[0] && cert[0].image_url) {
            const filePath = path.join(__dirname, 'public', 'img', cert[0].image_url);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }
        
        await db.query('DELETE FROM certificates WHERE id = ?', [id]);
        res.redirect('/admin/certificates?success=3');
    } catch (err) {
        console.error('Ошибка удаления:', err);
        res.redirect('/admin/certificates?error=3');
    }
});

// Админ: сортировка сертификатов
app.post('/admin/certificates/reorder', isAdmin, async (req, res) => {
    const { order } = req.body;
    
    try {
        for (let i = 0; i < order.length; i++) {
            await db.query(
                'UPDATE certificates SET order_index = ? WHERE id = ?',
                [i, order[i]]
            );
        }
        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка сортировки:', err);
        res.status(500).json({ error: 'Ошибка' });
    }
});


// ========== УПРАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯМИ (АДМИН) ==========

// Страница списка пользователей
app.get('/admin/users', isAdmin, async (req, res) => {
    try {
        const { search, role, sort, order } = req.query;
        
        let query = `
            SELECT u.id, u.username, u.full_name, u.email, u.phone, u.role, u.created_at, u.is_blocked,
                   (SELECT COUNT(*) FROM quiz_results WHERE user_id = u.id) as quiz_count
            FROM users u
            WHERE 1=1
        `;
        const params = [];
        
        if (search) {
            query += ` AND (u.full_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)`;
            const searchParam = `%${search}%`;
            params.push(searchParam, searchParam, searchParam);
        }
        
        if (role && role !== 'all') {
            query += ` AND u.role = ?`;
            params.push(role);
        }
        
        const sortColumn = sort === 'id' ? 'u.id' : sort === 'name' ? 'u.full_name' : sort === 'date' ? 'u.created_at' : 'u.id';
        const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
        query += ` ORDER BY ${sortColumn} ${sortOrder}`;
        
        const [users] = await db.query(query, params);
        
        res.render('admin/users', {
            title: 'Пользователи | Админ-панель',
            users: users,
            search: search || '',
            role: role || 'all',
            sort: sort || 'id',
            order: order || 'desc',
            success: req.query.success,
            error: req.query.error
        });
    } catch (err) {
        console.error('Ошибка загрузки пользователей:', err);
        res.status(500).send('Ошибка загрузки пользователей');
    }
});

// Страница редактирования пользователя
// Страница редактирования пользователя
app.get('/admin/users/:id/edit', isAdmin, async (req, res) => {
    try {
        const userId = req.params.id;
        
        const [users] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
        if (users.length === 0) {
            return res.status(404).send('Пользователь не найден');
        }
        
        const user = users[0];
        
        // Квизы пользователя
        const [quizResults] = await db.query(
            'SELECT * FROM quiz_results WHERE user_id = ? ORDER BY created_at DESC',
            [userId]
        );
        
        // Сообщения пользователя
        const [messages] = await db.query(
            'SELECT * FROM contact_messages WHERE email = ? ORDER BY created_at DESC',
            [user.email]
        );
        
        // Заявки на звонок
        const [callbacks] = await db.query(
            'SELECT * FROM callbacks WHERE phone = ? ORDER BY created_at DESC',
            [user.phone || '']
        );
        
        res.render('admin/user_edit', {
            title: `Редактирование: ${user.full_name} | Админ`,
            user: user,
            currentUserId: req.session.user.id,
            quizResults: quizResults,
            messages: messages,
            callbacks: callbacks,
            success: req.query.success,
            error: req.query.error
        });
    } catch (err) {
        console.error('Ошибка:', err);
        res.status(500).send('Ошибка загрузки');
    }
});

// Обновление пользователя
app.post('/admin/users/:id/update', isAdmin, async (req, res) => {
    const userId = req.params.id;
    const { full_name, email, phone, role, is_blocked } = req.body;
    
    // Нельзя менять роль у самого себя
    if (userId == req.session.user.id && role !== req.session.user.role) {
        return res.redirect(`/admin/users/${userId}/edit?error=Нельзя изменить свою роль`);
    }
    
    try {
        await db.query(
            'UPDATE users SET full_name = ?, email = ?, phone = ?, role = ?, is_blocked = ? WHERE id = ?',
            [full_name, email, phone || null, role, is_blocked === 'on' ? 1 : 0, userId]
        );
        res.redirect(`/admin/users/${userId}/edit?success=1`);
    } catch (err) {
        console.error('Ошибка обновления:', err);
        res.redirect(`/admin/users/${userId}/edit?error=1`);
    }
});

// Сброс пароля
app.post('/admin/users/:id/reset-password', isAdmin, async (req, res) => {
    const userId = req.params.id;
    const { new_password } = req.body;
    
    if (!new_password || new_password.length < 4) {
        return res.redirect(`/admin/users/${userId}/edit?error=Пароль должен быть не менее 4 символов`);
    }
    
    try {
        const hashedPassword = await bcrypt.hash(new_password, 10);
        await db.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, userId]);
        res.redirect(`/admin/users/${userId}/edit?success=Пароль изменен`);
    } catch (err) {
        console.error('Ошибка сброса пароля:', err);
        res.redirect(`/admin/users/${userId}/edit?error=Ошибка при сбросе пароля`);
    }
});

// Удаление пользователя
app.post('/admin/users/:id/delete', isAdmin, async (req, res) => {
    const userId = req.params.id;
    
    if (userId == req.session.user.id) {
        return res.redirect('/admin/users?error=Нельзя удалить самого себя');
    }
    
    try {
        // Проверяем, не админ ли
        const [users] = await db.query('SELECT role FROM users WHERE id = ?', [userId]);
        if (users.length > 0 && users[0].role === 'admin') {
            return res.redirect('/admin/users?error=Нельзя удалить администратора');
        }
        
        // Удаляем связанные данные
        await db.query('DELETE FROM quiz_results WHERE user_id = ?', [userId]);
        await db.query('DELETE FROM users WHERE id = ?', [userId]);
        
        res.redirect('/admin/users?success=Пользователь удален');
    } catch (err) {
        console.error('Ошибка удаления:', err);
        res.redirect('/admin/users?error=Ошибка при удалении');
    }
});

// ========== ИИ-ЧАТ БОТ ==========

// Функция для получения ответа от GigaChat
async function getBotResponse(userMessage) {
    const https = require('https');
    const agent = new https.Agent({ rejectUnauthorized: false });
    
    const prompt = `Ты профессиональный консультант компании "ВентРесурс" - специалист по вентиляции и кондиционированию.

Твои правила:
1. Отвечай кратко и по делу (2-4 предложения)
2. Будь дружелюбным и профессиональным
3. Если вопрос про цену - назови примерный диапазон
4. Если вопрос про монтаж - опиши процесс
5. Если вопрос про гарантию - скажи про 3 года
6. Если не знаешь ответ - предложи оставить заявку
7. В конце всегда предлагай оставить телефон для детальной консультации

Вопрос пользователя: "${userMessage}"

Ответь как консультант ВентРесурс:`;

    try {
        const token = await getGigaChatToken();
        
        const response = await axios.post(
            'https://gigachat.devices.sberbank.ru/api/v1/chat/completions',
            {
                model: "GigaChat",
                messages: [
                    {
                        role: "system",
                        content: "Ты консультант компании ВентРесурс. Отвечай кратко, профессионально, дружелюбно. Всегда предлагай оставить контакты для детальной консультации."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                temperature: 0.7,
                max_tokens: 300,
                stream: false
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                timeout: 15000,
                httpsAgent: agent
            }
        );
        
        return response.data.choices[0].message.content;
        
    } catch (err) {
        console.error('Ошибка GigaChat в чате:', err.message);
        return "Извините, сейчас наблюдаются технические неполадки. Пожалуйста, оставьте свой номер телефона, и наш специалист свяжется с вами в ближайшее время.";
    }
}

// API: Отправка сообщения в чат
app.post('/api/chat/send', async (req, res) => {
    const { message, name, phone, sessionId } = req.body;
    
    if (!message) {
        return res.json({ error: 'Сообщение не может быть пустым' });
    }
    
    try {
        // Получаем ответ от ИИ
        const botResponse = await getBotResponse(message);
        
        // Проверяем, нужно ли связаться с оператором
        const needCall = botResponse.includes('оставьте') || 
                        botResponse.includes('номер') || 
                        botResponse.includes('свяжется');
        
        // Сохраняем в базу
        await db.query(
            `INSERT INTO chat_messages (session_id, user_name, user_phone, user_message, bot_response, need_call) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [sessionId, name || null, phone || null, message, botResponse, needCall ? 1 : 0]
        );
        
        // Если пользователь оставил контакты и нужно связаться - сохраняем в заявки
        if (needCall && (name || phone)) {
            await db.query(
                'INSERT INTO callbacks (name, phone, status) VALUES (?, ?, "new")',
                [name || 'Чат бот', phone || 'не указан']
            );
        }
        
        res.json({ 
            success: true, 
            response: botResponse,
            needCall: needCall
        });
        
    } catch (err) {
        console.error('Ошибка чата:', err);
        res.json({ 
            error: true, 
            response: "Извините, произошла ошибка. Пожалуйста, позвоните нам по телефону +7 (XXX) XXX-XX-XX"
        });
    }
});

// Админ: просмотр сообщений чата
app.get('/admin/chat', isAdmin, async (req, res) => {
    try {
        const [messages] = await db.query(
            'SELECT * FROM chat_messages ORDER BY created_at DESC LIMIT 100'
        );
        res.render('admin/chat', {
            title: 'История чатов | Админ',
            messages: messages
        });
    } catch (err) {
        console.error('Ошибка:', err);
        res.status(500).send('Ошибка загрузки');
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});






