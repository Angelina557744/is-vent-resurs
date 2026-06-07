const db = require('../config/db');
const axios = require('axios');
const https = require('https');
const bcrypt = require('bcryptjs');

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

exports.saveQuizResult = async (req, res) => {
    const userId = req.session.user.id;
    const quizData = req.body;
    
    try {
        // ===== РАСЧЕТ ЦЕНЫ НА БЭКЕНДЕ (та же формула) =====
        let price = quizData.area * 5000;
        
        if (quizData.budget_range === 'Стандарт') price *= 1.2;
        if (quizData.budget_range === 'Премиум') price *= 1.5;
        
        if (quizData.building_type === 'Холодоснабжение') price *= 1.1;
        if (quizData.building_type === 'Отопление') price *= 1.05;
        
        if (quizData.industry === 'Промышленность') price *= 1.2;
        if (quizData.industry === 'Медицина') price *= 1.15;
        
        if (quizData.automation === 'yes') price *= 1.1;
        
        if (quizData.ceiling_height && quizData.ceiling_height > 4) price *= 1.15;
        if (quizData.people_count && quizData.people_count > 10) price *= 1.05;
        
        price = Math.round(price / 1000) * 1000;
        
        // Формируем промпт для GigaChat с ПРАВИЛЬНОЙ суммой
        const prompt = `Клиент хочет ${quizData.building_type} для ${quizData.industry} объекта площадью ${quizData.area} м². Ориентировочный бюджет: ${price} руб. Дай короткую профессиональную рекомендацию (1-2 предложения) что нужно учесть. Не пиши цену, только советы.`;
        
        let recommendation = "Рекомендуем обратиться к нашим специалистам для точного расчета.";
        
        try {
            const token = await getGigaChatToken();
            const gigaResponse = await axios.post(
                'https://gigachat.devices.sberbank.ru/api/v1/chat/completions',
                {
                    model: "GigaChat",
                    messages: [{ role: "user", content: prompt }]
                },
                {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            if (gigaResponse.data.choices && gigaResponse.data.choices[0]) {
                recommendation = gigaResponse.data.choices[0].message.content;
            }
        } catch (gigaErr) {
            console.error('GigaChat error:', gigaErr.message);
        }
        
        // Сохраняем в БД с нашей ценой
        await db.query(
            `INSERT INTO quiz_results 
            (user_id, industry, building_type, area, ceiling_height, people_count, automation, budget_range, estimated_price, ai_recommendation) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, quizData.industry, quizData.building_type, quizData.area, 
             quizData.ceiling_height, quizData.people_count, quizData.automation === 'yes' ? 1 : 0,
             quizData.budget_range, price, recommendation]
        );
        
        // Возвращаем JSON с нашей ценой
        res.json({
            success: true,
            estimated_price: price,
            recommendation: recommendation
        });
        
    } catch (err) {
        console.error('Save quiz error:', err);
        res.status(500).json({ success: false, error: 'Ошибка сохранения' });
    }
};

exports.submitCallback = async (req, res) => {
    const { name, phone } = req.body;
    try {
        await db.query('INSERT INTO callbacks (name, phone) VALUES (?, ?)', [name, phone]);
        res.status(200).json({ message: 'success' });
    } catch (error) {
        res.status(500).json({ message: 'error' });
    }
};

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

async function getBotResponse(userMessage) {
    const agent = new https.Agent({ rejectUnauthorized: false });

    const prompt = `Ты профессиональный консультант компании "ВентРесурс" - 
    специалист в области проектирования, 
    поставки и монтажа инженерных систем.

Твои правила:
1. Отвечай кратко и по делу (2-4 предложения)0 
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

