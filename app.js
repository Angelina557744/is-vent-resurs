const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const axios = require('axios');


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


app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});






