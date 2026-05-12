const db = require('../config/db');
const axios = require('axios');
const https = require('https');
const bcrypt = require('bcryptjs');

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
                httpsAgent: new https.Agent({ rejectUnauthorized: false })
            }
        );
        return response.data.access_token;
    } catch (err) {
        console.error('Ошибка получения токена GigaChat:', err.message);
        throw err;
    }
}

// Функция для классификации сообщения через GigaChat
async function classifyMessageWithGigaChat(message) {
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
        const token = await getGigaChatToken();

        const response = await axios.post(
            'https://gigachat.devices.sberbank.ru/api/v1/chat/completions',
            {
                model: "GigaChat",
                messages: [
                    {
                        role: "system",
                        content: "Ты классификатор сообщений. Отвечай только названием категории: Ремонт, Проектирование, Сотрудничество, Цена, Общее. Никаких других слов."
                    },
                    { role: "user", content: prompt }
                ],
                temperature: 0.1,
                max_tokens: 20,
                stream: false
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                timeout: 10000,
                httpsAgent: agent
            }
        );

        let category = response.data.choices[0].message.content.trim();
        const validCategories = ['Ремонт', 'Проектирование', 'Сотрудничество', 'Цена', 'Общее'];
        if (!validCategories.includes(category)) {
            category = 'Общее';
        }
        return category;
    } catch (err) {
        console.error('Ошибка классификации:', err.message);
        return 'Общее';
    }
}

// ========== ЗАЯВКА НА УСЛУГУ ==========
exports.submitServiceOrder = async (req, res) => {
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
};

// ========== ОБНОВЛЕНИЕ ПРОФИЛЯ ==========
exports.updateProfile = async (req, res) => {
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

        req.session.user.email = email;
        req.session.user.phone = phone || null;

        res.json({ success: true, message: 'Профиль успешно обновлен' });
    } catch (err) {
        console.error('Ошибка обновления профиля:', err);
        res.json({ success: false, error: 'Ошибка при обновлении профиля' });
    }
};

// ========== СОХРАНЕНИЕ РЕЗУЛЬТАТОВ КВИЗА ==========
exports.saveQuizResult = async (req, res) => {
    const httpsAgent = new https.Agent({ rejectUnauthorized: false });

    const {
        building_type, area, people_count, budget_range, industry,
        ceiling_height, automation
    } = req.body;

    const userId = req.session.user.id;

    let estimated_price = parseFloat(area) * 5000;
    if (budget_range === 'Премиум') estimated_price *= 1.5;
    if (budget_range === 'Стандарт') estimated_price *= 1.2;
    if (building_type === 'Производство') estimated_price *= 1.3;

    const prompt = `Ты профессиональный инженер-консультант компании "ВентРесурс".

Данные клиента после квиза:
- Объект: ${building_type}
- Сфера: ${industry || 'не указана'}  
- Площадь: ${area} м²
- Высота: ${ceiling_height || '3'} м
- Людей: ${people_count}
- Бюджет: ${budget_range}
- Автоматизация: ${automation === 'yes' ? 'нужна' : 'не нужна'}
- Цена (ориентировочная стоимость): ${estimated_price.toLocaleString()} руб. НЕ ПЕРЕСЧИТЫВАЙ ЭТУ ЦЕНУ.

Напиши клиенту ответ от "ВентРесурс" по схеме:
1. Приветствие
2. Обоснование цены
3. Что входит в стоимость
4. Полезный совет
5. Предложение связаться

Ответ должен быть теплым, профессиональным, 4-6 предложений. Только русский язык.`;

    let recommendation = `Здравствуйте! Спасибо за обращение в компанию "ВентРесурс"!

Предварительная стоимость системы ${building_type.toLowerCase()} для вашего объекта площадью ${area} м² составляет ${estimated_price.toLocaleString()} рублей.

Эта цена включает: проектирование, оборудование (${budget_range} класс), доставку, монтаж и пусконаладку.

Для получения точного коммерческого предложения, пожалуйста, оставьте заявку на сайте или позвоните нам.

С уважением, команда ВентРесурс.`;

    try {
        const token = await getGigaChatToken();
        const response = await axios.post(
            'https://gigachat.devices.sberbank.ru/api/v1/chat/completions',
            {
                model: "GigaChat",
                messages: [
                    {
                        role: "system",
                        content: "Ты дружелюбный консультант компании ВентРесурс. Отвечай тепло, профессионально, кратко."
                    },
                    { role: "user", content: prompt }
                ],
                temperature: 0.8,
                max_tokens: 400,
                stream: false
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                timeout: 20000,
                httpsAgent: httpsAgent
            }
        );

        if (response.data?.choices?.[0]) {
            recommendation = response.data.choices[0].message.content;
        }
    } catch (err) {
        console.error('Ошибка GigaChat, используем стандартный ответ');
    }

    try {
        await db.query(
            `INSERT INTO quiz_results 
            (user_id, building_type, area, people_count, budget_range, estimated_price, ai_recommendation, industry, ceiling_height) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, building_type, area, people_count, budget_range, estimated_price, recommendation, industry || null, ceiling_height || null]
        );
        res.json({ success: true, recommendation: recommendation });
    } catch (dbErr) {
        console.error('Ошибка сохранения в БД:', dbErr);
        res.status(500).json({ success: false, error: 'Ошибка сохранения' });
    }
};

// ========== ЗАЯВКА НА ОБРАТНЫЙ ЗВОНОК ==========
exports.submitCallback = async (req, res) => {
    const { name, phone } = req.body;
    try {
        await db.query('INSERT INTO callbacks (name, phone) VALUES (?, ?)', [name, phone]);
        res.status(200).json({ message: 'success' });
    } catch (error) {
        res.status(500).json({ message: 'error' });
    }
};

// ========== КОНТАКТНОЕ СООБЩЕНИЕ ==========
exports.submitContactMessage = async (req, res) => {
    const { name, email, phone, message } = req.body;

    if (!name || !email || !message) {
        return res.status(400).json({ success: false, error: 'Заполните все обязательные поля' });
    }

    let category = 'Общее';

    try {
        category = await classifyMessageWithGigaChat(message);
        await db.query(
            'INSERT INTO contact_messages (name, email, phone, message, category, status) VALUES (?, ?, ?, ?, ?, ?)',
            [name, email, phone, message, category, 'new']
        );
        res.json({ success: true, message: 'Сообщение успешно отправлено' });
    } catch (err) {
        console.error('Ошибка:', err.message);
        res.status(500).json({ success: false, error: 'Ошибка сервера' });
    }
};

// ========== ПОЛУЧЕНИЕ СЕРТИФИКАТОВ ==========
exports.getCertificates = async (req, res) => {
    try {
        const [certificates] = await db.query(
            'SELECT * FROM certificates WHERE is_active = 1 ORDER BY order_index ASC'
        );
        res.json(certificates);
    } catch (err) {
        console.error('Ошибка получения сертификатов:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
};

// ========== ЧАТ-БОТ ==========
async function getBotResponse(userMessage) {
    const agent = new https.Agent({ rejectUnauthorized: false });

    const prompt = `Ты профессиональный консультант компании "ВентРесурс" - специалист в области проектирования, поставки и монтажа инженерных систем.

Твои правила:
1. Отвечай кратко и по делу (2-4 предложения)
2. Будь дружелюбным и профессиональным
3. Если вопрос про цену - назови примерный диапазон
4. Если вопрос про гарантию - скажи про 3 года
5. В конце всегда предлагай оставить телефон для детальной консультации

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
                        content: "Ты консультант компании ВентРесурс. Отвечай кратко, профессионально, дружелюбно."
                    },
                    { role: "user", content: prompt }
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
        return "Извините, сейчас технические неполадки. Пожалуйста, оставьте свой номер телефона, и наш специалист свяжется с вами.";
    }
}

exports.sendChatMessage = async (req, res) => {
    const { message, name, phone, sessionId } = req.body;

    if (!message) {
        return res.json({ error: 'Сообщение не может быть пустым' });
    }

    try {
        const botResponse = await getBotResponse(message);
        const needCall = botResponse.includes('оставьте') ||
            botResponse.includes('номер') ||
            botResponse.includes('свяжется');

        await db.query(
            `INSERT INTO chat_messages (session_id, user_name, user_phone, user_message, bot_response, need_call) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [sessionId, name || null, phone || null, message, botResponse, needCall ? 1 : 0]
        );

        if (needCall && (name || phone)) {
            await db.query('INSERT INTO callbacks (name, phone, status) VALUES (?, ?, "new")',
                [name || 'Чат бот', phone || 'не указан']);
        }

        res.json({ success: true, response: botResponse, needCall: needCall });
    } catch (err) {
        console.error('Ошибка чата:', err);
        res.json({ error: true, response: "Извините, произошла ошибка. Пожалуйста, позвоните нам." });
    }
};

// ========== ОБРАБОТКА РЕДАКТИРОВАНИЯ УСЛУГИ (с фото) ==========
// Эти функции требуют multer, поэтому маршруты с ними будем обрабатывать в routes
// Но логику вынесем сюда