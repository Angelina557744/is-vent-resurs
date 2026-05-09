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
    res.status(403).render('403', { 
        title: 'Доступ запрещен | ВентРесурс'
    });
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


// Страница отдельной услуги
app.get('/services/:id', async (req, res) => {
    try {
        const serviceId = req.params.id;
        const [services] = await db.query('SELECT * FROM services WHERE id = ?', [serviceId]);
        
        if (services.length === 0) {
            return res.status(404).render('404', { title: 'Услуга не найдена' });
        }
        
        const service = services[0];
        
        // Парсим дополнительные фото - ИСПРАВЛЕНО
        let additionalImages = [];
        if (service.images_json && service.images_json !== 'null' && service.images_json !== '') {
            try {
                // Если images_json уже массив строк
                if (typeof service.images_json === 'string') {
                    additionalImages = JSON.parse(service.images_json);
                } else if (Array.isArray(service.images_json)) {
                    additionalImages = service.images_json;
                }
            } catch(e) { 
                console.error('Ошибка парсинга images_json:', e);
                additionalImages = []; 
            }
        }
        
        // Получаем все услуги для выпадающего списка
        const [allServices] = await db.query('SELECT id, title FROM services ORDER BY title');
        
        res.render('service_detail', {
            title: `${service.title} | ВентРесурс`,
            service: service,
            additionalImages: additionalImages,
            allServices: allServices,
            user: req.session.user || null
        });
    } catch (err) {
        console.error('Ошибка загрузки услуги:', err);
        res.status(500).send('Ошибка загрузки страницы');
    }
});

// API: отправка заявки на услугу
app.post('/api/service-order', async (req, res) => {
    const { service_id, service_title, name, email, phone, comment } = req.body;
    const userId = req.session.user?.id || null;
    
    try {
        await db.query(
            'INSERT INTO service_orders (user_id, service_id, service_title, name, email, phone, comment, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [userId, service_id, service_title, name, email, phone, comment, 'new']
        );
        
        res.json({ success: true, message: 'Заявка успешно отправлена' });
    } catch (err) {
        console.error('Ошибка сохранения заявки:', err);
        res.status(500).json({ success: false, error: 'Ошибка сервера' });
    }
});

// Админ: редактирование услуги (страница)
// Админ: редактирование услуги (страница)
app.get('/admin/services/edit/:id', isAdmin, async (req, res) => {
    try {
        const [services] = await db.query('SELECT * FROM services WHERE id = ?', [req.params.id]);
        if (services.length === 0) {
            return res.status(404).send('Услуга не найдена');
        }
        
        const service = services[0];
        let additionalImages = [];
        if (service.images_json) {
            try {
                additionalImages = JSON.parse(service.images_json);
            } catch(e) { additionalImages = []; }
        }
        
        res.render('admin/service_edit', {
            title: 'Редактирование услуги | Админ',
            service: service,
            additionalImages: additionalImages,
            error: req.query.error  // <-- ДОБАВЬТЕ ЭТУ СТРОКУ
        });
    } catch (err) {
        console.error('Ошибка:', err);
        res.status(500).send('Ошибка загрузки');
    }
});

// Админ: обновление услуги
// Админ: обновление услуги с загрузкой фото
app.post('/admin/services/update/:id', isAdmin, upload.fields([
    { name: 'main_image', maxCount: 1 },
    { name: 'additional_images', maxCount: 10 }
]), async (req, res) => {
    const { title, description, full_description, price, seo_title, seo_description } = req.body;
    const serviceId = req.params.id;
    
    try {
        // Получаем текущие данные услуги
        const [services] = await db.query('SELECT * FROM services WHERE id = ?', [serviceId]);
        if (services.length === 0) {
            return res.redirect('/admin/services?error=notfound');
        }
        const currentService = services[0];
        
        let image_url = currentService.image_url;
        let images_json = currentService.images_json;
        
        // Проверяем, есть ли загруженные файлы
        const files = req.files || {};
        
        // Обработка главного фото
        if (files.main_image && files.main_image[0]) {
            // Удаляем старое фото если есть
            if (image_url && image_url !== '') {
                const oldImagePath = `public/img/${image_url}`;
                if (fs.existsSync(oldImagePath)) {
                    fs.unlinkSync(oldImagePath);
                }
            }
            image_url = files.main_image[0].filename;
        }
        
        // Обработка дополнительных фото
        if (files.additional_images && files.additional_images.length > 0) {
            let currentImages = [];
            if (images_json && images_json !== '') {
                try {
                    currentImages = JSON.parse(images_json);
                } catch(e) { 
                    currentImages = []; 
                }
            }
            
            // Добавляем новые фото
            files.additional_images.forEach(file => {
                currentImages.push(file.filename);
            });
            
            images_json = JSON.stringify(currentImages);
        }
        
        await db.query(
            'UPDATE services SET title = ?, description = ?, full_description = ?, price = ?, image_url = ?, images_json = ?, seo_title = ?, seo_description = ? WHERE id = ?',
            [title, description, full_description, price, image_url, images_json, seo_title || title, seo_description || description, serviceId]
        );
        
        res.redirect('/admin/services?success=updated');
    } catch (err) {
        console.error('Ошибка обновления:', err);
        res.redirect(`/admin/services/edit/${serviceId}?error=1`);
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
            req.session.user = { 
                id: user.id, 
                username: user.username, 
                full_name: user.full_name, 
                role: user.role,
                email: user.email,
                phone: user.phone
            };
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

        const [userProjects] = await db.query(`
    SELECT p.*, s.title as service_title
    FROM user_projects p
    LEFT JOIN services s ON p.service_id = s.id
    WHERE p.user_id = ?
    ORDER BY p.created_at DESC
`, [userId]);

        res.render('profile', { 
            title: 'Личный кабинет | ВентРесурс',
            user: req.session.user,
            quizResults: quizResults,
            notifications: userMessages,
            userProjects: userProjects
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка при загрузке профиля');
    }
});

app.get('/profile/quiz', isAuth, (req, res) => {
    res.render('quiz', { title: 'Подбор системы вентиляции' });
});
app.post('/api/profile/update', isAuth, async (req, res) => {
    const userId = req.session.user.id;
    const { email, phone, password } = req.body;
    
    try {
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
        
        if (password && password.length >= 4) {
            const hashedPassword = await bcrypt.hash(password, 10);
            query += ', password = ?';
            params.push(hashedPassword);
        }
        
        query += ' WHERE id = ?';
        params.push(userId);
        
        await db.query(query, params);
        
        // Обновляем данные в сессии
        req.session.user.email = email;
        req.session.user.phone = phone || null;
        
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
- - Цена (ориентировочная стоимость, рассчитанная нашим калькулятором): ${estimated_price.toLocaleString()} руб. НЕ ПЕРЕСЧИТЫВАЙ ЭТУ ЦЕНУ, используй её в ответе как есть.

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
        const [pRes] = await db.query('SELECT COUNT(*) as count FROM projects'); // старые проекты (портфолио)
        const [uRes] = await db.query('SELECT COUNT(*) as count FROM users');
        const [mRes] = await db.query('SELECT COUNT(*) as count FROM contact_messages');
        
        // НОВОЕ: получаем количество проектов клиентов из таблицы user_projects
        const [upRes] = await db.query('SELECT COUNT(*) as count FROM user_projects');

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
                projects: pRes[0]?.count || 0,      // портфолио (наши работы)
                users: uRes[0]?.count || 0,
                messages: mRes[0]?.count || 0,
                userProjects: upRes[0]?.count || 0   // НОВОЕ: проекты клиентов
            },
            recentQuiz: recentQuiz || []
        });
    } catch (err) {
        console.error("КРИТИЧЕСКАЯ ОШИБКА АДМИНКИ:", err);
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

app.post('/api/contact-message', async (req, res) => {
    const { name, email, phone, message } = req.body;
    
    // Валидация обязательных полей
    if (!name || !email || !message) {
        console.error('Ошибка: Не все обязательные поля заполнены');
        return res.status(400).json({ success: false, error: 'Заполните все обязательные поля' });
    }
    
    console.log('--- НОВОЕ СООБЩЕНИЕ ОТ ПОЛЬЗОВАТЕЛЯ ---');
    console.log(`От: ${name} (${email})`);
    console.log(`Сообщение: ${message.substring(0, 100)}...`);
    
    let category = 'Общее';
    
    // Вызываем классификацию через GigaChat
    try {
        category = await classifyMessageWithGigaChat(message);
        console.log(`Категория определена: ${category}`);
    } catch (err) {
        console.error('Классификация не удалась, используем категорию по умолчанию');
        category = 'Общее';
    }
    
    // Сохраняем в базу данных
    try {
        await db.query(
            'INSERT INTO contact_messages (name, email, phone, message, category, status) VALUES (?, ?, ?, ?, ?, ?)',
            [name, email, phone, message, category, 'new']
        );
        console.log('Сообщение сохранено в базу данных');
        res.json({ success: true, message: 'Сообщение успешно отправлено' });
        
    } catch (dbErr) {
        console.error('Ошибка сохранения в БД:', dbErr.message);
        res.status(500).json({ success: false, error: 'Ошибка сервера при сохранении' });
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
    
    const prompt = `Ты профессиональный консультант компании "ВентРесурс" - являешься специалистом в области проектирования, поставки и монтажа инженерных систем для промышленности, включая вентиляцию, теплоснабжение, холодоснабжение и автоматизацию.

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




// ========== УПРАВЛЕНИЕ ПРОЕКТАМИ (АДМИН) ==========

// Список всех проектов
app.get('/admin/user-projects', isAdmin, async (req, res) => {
    try {
        const [projects] = await db.query(`
            SELECT p.*, u.full_name as user_name, u.email as user_email, s.title as service_title
            FROM user_projects p
            LEFT JOIN users u ON p.user_id = u.id
            LEFT JOIN services s ON p.service_id = s.id
            ORDER BY p.created_at DESC
        `);
        
        // Статистика по статусам
        const [stats] = await db.query(`
            SELECT status, COUNT(*) as count FROM user_projects GROUP BY status
        `);
        
        const statusStats = {};
        stats.forEach(s => { statusStats[s.status] = s.count; });
        
        res.render('admin/user_projects', {
            title: 'Проекты клиентов | Админ',
            projects: projects,
            stats: statusStats,
            success: req.query.success,
            error: req.query.error
        });
    } catch (err) {
        console.error('Ошибка:', err);
        res.status(500).send('Ошибка загрузки проектов');
    }
});

// Страница создания проекта (выбор пользователя)
app.get('/admin/user-projects/create', isAdmin, async (req, res) => {
    try {
        const [users] = await db.query('SELECT id, full_name, email FROM users ORDER BY full_name');
        const [services] = await db.query('SELECT id, title FROM services ORDER BY title');
        
        res.render('admin/user_project_create', {
            title: 'Создание проекта | Админ',
            users: users,
            services: services,
            error: req.query.error
        });
    } catch (err) {
        console.error('Ошибка:', err);
        res.status(500).send('Ошибка загрузки');
    }
});

// Создание проекта
app.post('/admin/user-projects/create', isAdmin, async (req, res) => {
    const { user_id, service_id, title, address, status } = req.body;
    
    if (!user_id || !title) {
        return res.redirect('/admin/user-projects/create?error=Заполните обязательные поля');
    }
    
    try {
        await db.query(
            `INSERT INTO user_projects (user_id, service_id, title, address, status) 
             VALUES (?, ?, ?, ?, ?)`,
            [user_id, service_id || null, title, address || null, status || 'approved']
        );
        res.redirect('/admin/user-projects?success=Проект создан');
    } catch (err) {
        console.error('Ошибка:', err);
        res.redirect('/admin/user-projects/create?error=Ошибка при создании');
    }
});

// Детальная страница проекта (админ)
app.get('/admin/user-projects/:id', isAdmin, async (req, res) => {
    const projectId = req.params.id;
    
    try {
        // Данные проекта
        const [projects] = await db.query(`
            SELECT p.*, u.full_name as user_name, u.email as user_email, u.phone as user_phone, s.title as service_title
            FROM user_projects p
            LEFT JOIN users u ON p.user_id = u.id
            LEFT JOIN services s ON p.service_id = s.id
            WHERE p.id = ?
        `, [projectId]);
        
        if (projects.length === 0) {
            return res.status(404).send('Проект не найден');
        }
        
        const project = projects[0];
        
        // Сообщения чата
        const [messages] = await db.query(`
            SELECT m.*, u.full_name as user_name
            FROM project_messages m
            LEFT JOIN users u ON m.user_id = u.id
            WHERE m.project_id = ?
            ORDER BY m.created_at ASC
        `, [projectId]);
        
        // Фото
        const [photos] = await db.query(
            'SELECT * FROM project_photos WHERE project_id = ? ORDER BY created_at DESC',
            [projectId]
        );
        
        // Документы
        const [documents] = await db.query(
            'SELECT * FROM project_documents WHERE project_id = ? ORDER BY created_at DESC',
            [projectId]
        );
        
        // Статусы для выпадающего списка
        const statuses = [
            { value: 'awaiting_approval', label: 'Ожидание одобрения' },
            { value: 'approved', label: 'Одобрено' },
            { value: 'design', label: 'Проектирование' },
            { value: 'supply', label: 'Поставка оборудования' },
            { value: 'installation', label: 'Монтажные работы' },
            { value: 'commissioning', label: 'Пусконаладка' },
            { value: 'completed', label: 'Работы завершены' }
        ];
        
        res.render('admin/user_project_detail', {
            title: `Проект: ${project.title} | Админ`,
            project: project,
            messages: messages,
            photos: photos,
            documents: documents,
            statuses: statuses,
            success: req.query.success,
            error: req.query.error
        });
    } catch (err) {
        console.error('Ошибка:', err);
        res.status(500).send('Ошибка загрузки проекта');
    }
});

// Обновление статуса проекта
app.post('/admin/user-projects/:id/status', isAdmin, async (req, res) => {
    const projectId = req.params.id;
    const { status } = req.body;
    
    try {
        await db.query(
            'UPDATE user_projects SET status = ? WHERE id = ?',
            [status, projectId]
        );
        res.redirect(`/admin/user-projects/${projectId}?success=Статус обновлен`);
    } catch (err) {
        console.error('Ошибка:', err);
        res.redirect(`/admin/user-projects/${projectId}?error=Ошибка`);
    }
});

// Обновление названия и адреса проекта
app.post('/admin/user-projects/:id/update', isAdmin, async (req, res) => {
    const projectId = req.params.id;
    const { title, address, service_id } = req.body;
    
    try {
        await db.query(
            'UPDATE user_projects SET title = ?, address = ?, service_id = ? WHERE id = ?',
            [title, address || null, service_id || null, projectId]
        );
        res.redirect(`/admin/user-projects/${projectId}?success=Данные обновлены`);
    } catch (err) {
        console.error('Ошибка:', err);
        res.redirect(`/admin/user-projects/${projectId}?error=Ошибка`);
    }
});

// Добавление сообщения от админа
app.post('/admin/user-projects/:id/message', isAdmin, async (req, res) => {
    const projectId = req.params.id;
    const { message } = req.body;
    const adminId = req.session.user.id;
    
    if (!message) {
        return res.redirect(`/admin/user-projects/${projectId}?error=Введите сообщение`);
    }
    
    try {
        await db.query(
            'INSERT INTO project_messages (project_id, user_id, message, is_admin) VALUES (?, ?, ?, ?)',
            [projectId, adminId, message, 1]
        );
        res.redirect(`/admin/user-projects/${projectId}?success=Сообщение отправлено`);
    } catch (err) {
        console.error('Ошибка:', err);
        res.redirect(`/admin/user-projects/${projectId}?error=Ошибка`);
    }
});



// Создаем папку для фото проектов, если её нет
const projectPhotosDir = 'public/uploads/projects';
if (!fs.existsSync(projectPhotosDir)) {
    fs.mkdirSync(projectPhotosDir, { recursive: true });
}

const projectPhotoStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, projectPhotosDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'project-' + uniqueSuffix + '.jpg');
    }
});
const uploadProjectPhoto = multer({ storage: projectPhotoStorage });

app.post('/admin/user-projects/:id/photo', isAdmin, uploadProjectPhoto.single('photo'), async (req, res) => {
    const projectId = req.params.id;
    
    if (!req.file) {
        return res.redirect(`/admin/user-projects/${projectId}?error=Выберите фото`);
    }
    
    try {
        await db.query(
            'INSERT INTO project_photos (project_id, image_url, description) VALUES (?, ?, ?)',
            [projectId, 'uploads/projects/' + req.file.filename, req.body.description || null]
        );
        res.redirect(`/admin/user-projects/${projectId}?success=Фото добавлено`);
    } catch (err) {
        console.error('Ошибка:', err);
        res.redirect(`/admin/user-projects/${projectId}?error=Ошибка`);
    }
});

// Удаление фото
app.post('/admin/user-projects/photo/:photoId/delete', isAdmin, async (req, res) => {
    const photoId = req.params.photoId;
    
    try {
        const [photos] = await db.query('SELECT * FROM project_photos WHERE id = ?', [photoId]);
        if (photos.length > 0) {
            const filePath = 'public/' + photos[0].image_url;
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }
        await db.query('DELETE FROM project_photos WHERE id = ?', [photoId]);
        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка:', err);
        res.json({ success: false });
    }
});

// Загрузка документа
const projectDocsDir = 'public/uploads/projects/docs';
if (!fs.existsSync(projectDocsDir)) {
    fs.mkdirSync(projectDocsDir, { recursive: true });
}

const projectDocStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, projectDocsDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = file.originalname.split('.').pop();
        cb(null, 'doc-' + uniqueSuffix + '.' + ext);
    }
});
const uploadProjectDoc = multer({ storage: projectDocStorage });

app.post('/admin/user-projects/:id/document', isAdmin, uploadProjectDoc.single('document'), async (req, res) => {
    const projectId = req.params.id;
    const { title } = req.body;
    
    if (!req.file) {
        return res.redirect(`/admin/user-projects/${projectId}?error=Выберите файл`);
    }
    
    try {
        await db.query(
            'INSERT INTO project_documents (project_id, title, file_url, file_size, uploaded_by) VALUES (?, ?, ?, ?, ?)',
            [projectId, title || req.file.originalname, 'uploads/projects/docs/' + req.file.filename, req.file.size, 'admin']
        );
        res.redirect(`/admin/user-projects/${projectId}?success=Документ добавлен`);
    } catch (err) {
        console.error('Ошибка:', err);
        res.redirect(`/admin/user-projects/${projectId}?error=Ошибка`);
    }
});

// Удаление документа
app.post('/admin/user-projects/document/:docId/delete', isAdmin, async (req, res) => {
    const docId = req.params.docId;
    
    try {
        const [docs] = await db.query('SELECT * FROM project_documents WHERE id = ?', [docId]);
        if (docs.length > 0) {
            const filePath = 'public/' + docs[0].file_url;
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }
        await db.query('DELETE FROM project_documents WHERE id = ?', [docId]);
        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка:', err);
        res.json({ success: false });
    }
});

// Удаление проекта
app.post('/admin/user-projects/:id/delete', isAdmin, async (req, res) => {
    const projectId = req.params.id;
    
    try {
        // Удаляем файлы фото
        const [photos] = await db.query('SELECT * FROM project_photos WHERE project_id = ?', [projectId]);
        for (const photo of photos) {
            const filePath = 'public/' + photo.image_url;
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }
        
        // Удаляем файлы документов
        const [docs] = await db.query('SELECT * FROM project_documents WHERE project_id = ?', [projectId]);
        for (const doc of docs) {
            const filePath = 'public/' + doc.file_url;
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }
        
        // Удаляем проект (каскадно удалит сообщения, фото, документы)
        await db.query('DELETE FROM user_projects WHERE id = ?', [projectId]);
        
        res.redirect('/admin/user-projects?success=Проект удален');
    } catch (err) {
        console.error('Ошибка:', err);
        res.redirect(`/admin/user-projects/${projectId}?error=Ошибка при удалении`);
    }
});


// ========== ПРОЕКТЫ КЛИЕНТА (ЛИЧНЫЙ КАБИНЕТ) ==========

// Страница детального просмотра проекта
app.get('/profile/projects/:id', isAuth, async (req, res) => {
    const projectId = req.params.id;
    const userId = req.session.user.id;
    
    try {
        // Проверяем, что проект принадлежит текущему пользователю
        const [projects] = await db.query(`
            SELECT p.*, s.title as service_title
            FROM user_projects p
            LEFT JOIN services s ON p.service_id = s.id
            WHERE p.id = ? AND p.user_id = ?
        `, [projectId, userId]);
        
        if (projects.length === 0) {
            return res.status(404).send('Проект не найден или доступ запрещен');
        }
        
        const project = projects[0];
        
        // Сообщения по проекту
        const [messages] = await db.query(`
            SELECT m.*, 
                   CASE WHEN m.is_admin = 1 THEN 'Администратор' ELSE ? END as author_name
            FROM project_messages m
            WHERE m.project_id = ?
            ORDER BY m.created_at ASC
        `, [req.session.user.full_name, projectId]);
        
        // Фото по проекту
        const [photos] = await db.query(
            'SELECT * FROM project_photos WHERE project_id = ? ORDER BY created_at DESC',
            [projectId]
        );
        
        // Документы по проекту
        const [documents] = await db.query(
            'SELECT * FROM project_documents WHERE project_id = ? ORDER BY created_at DESC',
            [projectId]
        );
        
        // Статусы для отображения
        const statuses = {
            'awaiting_approval': { label: 'Ожидание одобрения', progress: 0 },
            'approved': { label: 'Заявка одобрена', progress: 10 },
            'design': { label: 'Проектирование', progress: 25 },
            'supply': { label: 'Поставка оборудования', progress: 45 },
            'installation': { label: 'Монтажные работы', progress: 70 },
            'commissioning': { label: 'Пусконаладка', progress: 85 },
            'completed': { label: 'Работы завершены', progress: 100 }
        };
        
        res.render('profile_project_detail', {
            title: `${project.title} | ВентРесурс`,
            project: project,
            messages: messages,
            photos: photos,
            documents: documents,
            statuses: statuses,
            user: req.session.user,
            success: req.query.success,  // <-- ДОБАВИТЬ
            error: req.query.error        // <-- ДОБАВИТЬ
        });
        
    } catch (err) {
        console.error('Ошибка загрузки проекта:', err);
        res.status(500).send('Ошибка загрузки страницы');
    }
});

// Отправка сообщения по проекту от клиента
app.post('/profile/projects/:id/message', isAuth, async (req, res) => {
    const projectId = req.params.id;
    const userId = req.session.user.id;
    const { message } = req.body;
    
    if (!message) {
        return res.redirect(`/profile/projects/${projectId}?error=Введите сообщение`);
    }
    
    try {
        await db.query(
            'INSERT INTO project_messages (project_id, user_id, message, is_admin) VALUES (?, ?, ?, ?)',
            [projectId, userId, message, 0]
        );
        res.redirect(`/profile/projects/${projectId}?success=Сообщение отправлено`);
    } catch (err) {
        console.error('Ошибка:', err);
        res.redirect(`/profile/projects/${projectId}?error=Ошибка`);
    }
});

// ========== УПРАВЛЕНИЕ ЗАЯВКАМИ НА УСЛУГИ (АДМИН) ==========

// Список заявок на услуги
app.get('/admin/service-orders', isAdmin, async (req, res) => {
    try {
        const [orders] = await db.query(`
            SELECT so.*, u.full_name as user_name, u.email as user_email
            FROM service_orders so
            LEFT JOIN users u ON so.user_id = u.id
            ORDER BY so.created_at DESC
        `);
        
        res.render('admin/service_orders', {
            title: 'Заявки на услуги | Админ',
            orders: orders,
            success: req.query.success,
            error: req.query.error
        });
    } catch (err) {
        console.error('Ошибка:', err);
        res.status(500).send('Ошибка загрузки заявок');
    }
});

// Одобрение заявки и создание проекта
app.post('/admin/service-orders/:id/approve', isAdmin, async (req, res) => {
    const orderId = req.params.id;
    
    try {
        // Получаем данные заявки
        const [orders] = await db.query('SELECT * FROM service_orders WHERE id = ?', [orderId]);
        if (orders.length === 0) {
            return res.redirect('/admin/service-orders?error=Заявка не найдена');
        }
        
        const order = orders[0];
        
        // Проверяем, не создан ли уже проект для этой заявки
        if (order.project_id) {
            return res.redirect('/admin/service-orders?error=Проект для этой заявки уже создан');
        }
        
        // Ищем пользователя по email
        let userId = order.user_id;
        
        if (!userId) {
            // Пытаемся найти пользователя по email из заявки
            const [users] = await db.query('SELECT id FROM users WHERE email = ?', [order.email]);
            
            if (users.length > 0) {
                // Пользователь найден
                userId = users[0].id;
            } else {
                // Создаем нового пользователя
                const username = order.email.split('@')[0] + '_' + Date.now();
                const hashedPassword = await bcrypt.hash('user123456', 10);
                
                const [result] = await db.query(
                    'INSERT INTO users (username, full_name, email, phone, password, role) VALUES (?, ?, ?, ?, ?, ?)',
                    [username, order.name, order.email, order.phone, hashedPassword, 'user']
                );
                userId = result.insertId;
            }
        }
        
        // Создаем проект
        const projectTitle = `${order.service_title} - ${order.name}`;
        
        const [projectResult] = await db.query(
            `INSERT INTO user_projects (user_id, service_id, title, address, status, created_at) 
             VALUES (?, ?, ?, ?, 'approved', NOW())`,
            [userId, order.service_id, projectTitle, null]
        );
        
        const projectId = projectResult.insertId;
        
        // Обновляем заявку: ставим статус approved и связываем с проектом
        await db.query(
            'UPDATE service_orders SET status = "approved", project_id = ? WHERE id = ?',
            [projectId, orderId]
        );
        
        // Добавляем приветственное сообщение в чат проекта
        await db.query(
            `INSERT INTO project_messages (project_id, user_id, message, is_admin, created_at) 
             VALUES (?, ?, ?, ?, NOW())`,
            [projectId, userId, `Здравствуйте! Ваша заявка на услугу "${order.service_title}" одобрена. Проект создан. Наш специалист свяжется с вами для уточнения деталей.`, 1]
        );
        
        res.redirect(`/admin/service-orders?success=Заявка одобрена, проект #${projectId} создан`);
        
    } catch (err) {
        console.error('Ошибка одобрения заявки:', err);
        res.redirect('/admin/service-orders?error=Ошибка при одобрении');
    }
});

// Отклонение заявки
app.post('/admin/service-orders/:id/reject', isAdmin, async (req, res) => {
    const orderId = req.params.id;
    
    try {
        await db.query('UPDATE service_orders SET status = "rejected" WHERE id = ?', [orderId]);
        res.redirect('/admin/service-orders?success=Заявка отклонена');
    } catch (err) {
        console.error('Ошибка:', err);
        res.redirect('/admin/service-orders?error=Ошибка');
    }
});

// Удаление заявки
app.post('/admin/service-orders/:id/delete', isAdmin, async (req, res) => {
    const orderId = req.params.id;
    
    try {
        await db.query('DELETE FROM service_orders WHERE id = ?', [orderId]);
        res.redirect('/admin/service-orders?success=Заявка удалена');
    } catch (err) {
        console.error('Ошибка:', err);
        res.redirect('/admin/service-orders?error=Ошибка');
    }
});

// Страница детального просмотра проекта
app.get('/projects/:year/:slug', async (req, res) => {
    const { year, slug } = req.params;
    
    try {
        const [projects] = await db.query(
            'SELECT * FROM projects WHERE year = ? AND slug = ?',
            [year, slug]
        );
        
        if (projects.length === 0) {
            return res.status(404).render('404', { title: 'Проект не найден' });
        }
        
        const project = projects[0];
        
        const [details] = await db.query(
            'SELECT * FROM project_details WHERE project_id = ?',
            [project.id]
        );
        
        const projectDetail = details[0] || null;
        
        let timeline = [];
        let photos = [];
        
        if (projectDetail) {
            [timeline] = await db.query(
                'SELECT * FROM project_timeline WHERE project_detail_id = ? ORDER BY display_order ASC',
                [projectDetail.id]
            );
            
            [photos] = await db.query(
                'SELECT * FROM project_detail_photos WHERE project_detail_id = ? ORDER BY display_order ASC',
                [projectDetail.id]
            );
        }
        
        res.render('project_detail', {
            title: `${project.title} | ВентРесурс`,
            project: project,
            projectDetail: projectDetail,
            timeline: timeline,
            photos: photos,
            user: req.session.user || null
        });
        
    } catch (err) {
        console.error('Ошибка:', err);
        res.status(500).send('Ошибка загрузки проекта');
    }
});

// Админ: управление детальным проектом
app.get('/admin/projects/:id/detail', isAdmin, async (req, res) => {
    const projectId = req.params.id;
    
    try {
        const [projects] = await db.query('SELECT * FROM projects WHERE id = ?', [projectId]);
        if (projects.length === 0) {
            return res.status(404).send('Проект не найден');
        }
        
        const project = projects[0];
        
        let [details] = await db.query('SELECT * FROM project_details WHERE project_id = ?', [projectId]);
        let projectDetail = details[0] || null;
        
        let timeline = [];
        let photos = [];
        
        if (projectDetail) {
            [timeline] = await db.query(
                'SELECT * FROM project_timeline WHERE project_detail_id = ? ORDER BY display_order ASC',
                [projectDetail.id]
            );
            
            [photos] = await db.query(
                'SELECT * FROM project_detail_photos WHERE project_detail_id = ? ORDER BY display_order ASC',
                [projectDetail.id]
            );
        }
        
        res.render('admin/project_detail_edit', {
            title: `Редактирование: ${project.title} | Админ`,
            project: project,
            projectDetail: projectDetail,
            timeline: timeline,
            photos: photos,
            success: req.query.success,
            error: req.query.error
        });
        
    } catch (err) {
        console.error('Ошибка:', err);
        res.status(500).send('Ошибка загрузки');
    }
});

// Админ: сохранение/обновление детального описания
app.post('/admin/projects/:id/detail/save', isAdmin, async (req, res) => {
    const projectId = req.params.id;
    const { description, year, title } = req.body;
    
    try {
        const [existing] = await db.query(
            'SELECT id FROM project_details WHERE project_id = ?',
            [projectId]
        );
        
        if (existing.length > 0) {
            await db.query(
                'UPDATE project_details SET description = ?, year = ?, title = ? WHERE project_id = ?',
                [description, year, title, projectId]
            );
        } else {
            await db.query(
                'INSERT INTO project_details (project_id, year, title, description) VALUES (?, ?, ?, ?)',
                [projectId, year, title, description]
            );
        }
        
        res.redirect(`/admin/projects/${projectId}/detail?success=1`);
        
    } catch (err) {
        console.error('Ошибка:', err);
        res.redirect(`/admin/projects/${projectId}/detail?error=1`);
    }
});

// Админ: добавление события в таймлайн
app.post('/admin/projects/timeline/add', isAdmin, async (req, res) => {
    const { project_detail_id, month_date, title, content, display_order } = req.body;
    
    try {
        await db.query(
            'INSERT INTO project_timeline (project_detail_id, month_date, title, content, display_order) VALUES (?, ?, ?, ?, ?)',
            [project_detail_id, month_date, title || null, content, display_order || 0]
        );
        
        const [detail] = await db.query('SELECT project_id FROM project_details WHERE id = ?', [project_detail_id]);
        res.redirect(`/admin/projects/${detail[0].project_id}/detail?success=2`);
        
    } catch (err) {
        console.error('Ошибка:', err);
        res.status(500).send('Ошибка добавления события');
    }
});

// Админ: удаление события из таймлайна
app.post('/admin/projects/timeline/:id/delete', isAdmin, async (req, res) => {
    const timelineId = req.params.id;
    
    try {
        const [timeline] = await db.query('SELECT project_detail_id FROM project_timeline WHERE id = ?', [timelineId]);
        const [detail] = await db.query('SELECT project_id FROM project_details WHERE id = ?', [timeline[0].project_detail_id]);
        
        await db.query('DELETE FROM project_timeline WHERE id = ?', [timelineId]);
        
        res.redirect(`/admin/projects/${detail[0].project_id}/detail?success=3`);
        
    } catch (err) {
        console.error('Ошибка:', err);
        res.status(500).send('Ошибка удаления');
    }
});

// Админ: добавление фото
app.post('/admin/projects/photos/add', isAdmin, upload.single('image'), async (req, res) => {
    const { project_detail_id, title, description, display_order } = req.body;
    
    if (!req.file) {
        return res.status(400).send('Фото не загружено');
    }
    
    try {
        await db.query(
            'INSERT INTO project_detail_photos (project_detail_id, image_url, title, description, display_order) VALUES (?, ?, ?, ?, ?)',
            [project_detail_id, req.file.filename, title || null, description || null, display_order || 0]
        );
        
        const [detail] = await db.query('SELECT project_id FROM project_details WHERE id = ?', [project_detail_id]);
        res.redirect(`/admin/projects/${detail[0].project_id}/detail?success=4`);
        
    } catch (err) {
        console.error('Ошибка:', err);
        res.status(500).send('Ошибка добавления фото');
    }
});

// Админ: удаление фото
app.post('/admin/projects/photos/:id/delete', isAdmin, async (req, res) => {
    const photoId = req.params.id;
    
    try {
        const [photo] = await db.query('SELECT * FROM project_detail_photos WHERE id = ?', [photoId]);
        
        if (photo[0] && photo[0].image_url) {
            const filePath = path.join(__dirname, 'public', 'img', photo[0].image_url);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }
        
        const [detail] = await db.query('SELECT project_id FROM project_details WHERE id = ?', [photo[0].project_detail_id]);
        
        await db.query('DELETE FROM project_detail_photos WHERE id = ?', [photoId]);
        
        res.redirect(`/admin/projects/${detail[0].project_id}/detail?success=5`);
        
    } catch (err) {
        console.error('Ошибка:', err);
        res.status(500).send('Ошибка удаления');
    }
});

// Админ: создание нового проекта (год)
app.post('/admin/projects/add', isAdmin, async (req, res) => {
    const { year, title, object_type, image_url, slug } = req.body;
    
    try {
        const [result] = await db.query(
            'INSERT INTO projects (year, title, object_type, image_url, slug) VALUES (?, ?, ?, ?, ?)',
            [year, title, object_type, image_url || null, slug || title.toLowerCase().replace(/\s+/g, '-')]
        );
        
        res.redirect('/admin/projects?success=1');
        
    } catch (err) {
        console.error('Ошибка:', err);
        res.redirect('/admin/projects?error=1');
    }
});


app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});






