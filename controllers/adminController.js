const db = require('../config/db');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

// ========== ГЛАВНАЯ АДМИН-ПАНЕЛИ ==========
// ========== ГЛАВНАЯ АДМИН-ПАНЕЛИ (адаптирована под роль) ==========
exports.getDashboard = async (req, res) => {
    try {
        const userRole = req.session.user.role;
        const isAdminUser = userRole === 'admin';

        // Базовые статистики (доступны всем)
        const [cRes] = await db.query('SELECT COUNT(*) as count FROM callbacks');
        const [mRes] = await db.query('SELECT COUNT(*) as count FROM contact_messages');
        const [upRes] = await db.query('SELECT COUNT(*) as count FROM user_projects');
        const [uRes] = await db.query('SELECT COUNT(*) as count FROM users');
        const [sRes] = await db.query('SELECT COUNT(*) as count FROM services');
        const [pRes] = await db.query('SELECT COUNT(*) as count FROM projects');

        const [recentQuiz] = await db.query(`
            SELECT qr.*, u.full_name, u.phone 
            FROM quiz_results qr 
            LEFT JOIN users u ON qr.user_id = u.id 
            ORDER BY qr.created_at DESC LIMIT 5
        `);

        const stats = {
            callbacks: cRes[0]?.count || 0,
            messages: mRes[0]?.count || 0,
            userProjects: upRes[0]?.count || 0,
            users: uRes[0]?.count || 0,
            services: sRes[0]?.count || 0,
            projects: pRes[0]?.count || 0
        };

        res.render('admin/dashboard', {
            title: 'Панель управления | ВентРесурс',
            userRole: userRole,
            isAdmin: isAdminUser,
            stats: stats,
            recentQuiz: recentQuiz || []
        });
    } catch (err) {
        console.error("Ошибка админки:", err);
        res.status(500).send(`Ошибка базы данных: ${err.message}`);
    }
};

// ========== ЗАЯВКИ НА ЗВОНОК ==========
exports.getCallbacks = async (req, res) => {
    try {
        const [callbacks] = await db.query('SELECT * FROM callbacks ORDER BY created_at DESC');
        res.render('admin/callbacks', {
            title: 'Заявки на звонок | Админ-панель',
            callbacks: callbacks || []
        });
    } catch (error) {
        res.status(500).send('Ошибка загрузки заявок');
    }
};

exports.updateCallbackStatus = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    try {
        await db.query('UPDATE callbacks SET status = ? WHERE id = ?', [status, id]);
        res.redirect('/admin/callbacks');
    } catch (error) {
        console.error('Ошибка обновления статуса:', error);
        res.status(500).send('Ошибка сервера');
    }
};

// ========== УПРАВЛЕНИЕ УСЛУГАМИ ==========
exports.getServices = async (req, res) => {
    try {
        const [services] = await db.query('SELECT * FROM services');
        res.render('admin/services', { title: 'Управление услугами', services });
    } catch (err) {
        res.status(500).send('Ошибка услуг');
    }
};

exports.addService = async (req, res) => {
    const { title, description, price, image_url } = req.body;
    try {
        await db.query('INSERT INTO services (title, description, price, image_url) VALUES (?, ?, ?, ?)',
            [title, description, price, image_url]);
        res.redirect('/admin/services');
    } catch (err) {
        res.status(500).send('Ошибка добавления');
    }
};

exports.deleteService = async (req, res) => {
    try {
        await db.query('DELETE FROM services WHERE id = ?', [req.params.id]);
        res.redirect('/admin/services');
    } catch (err) {
        res.status(500).send('Ошибка удаления');
    }
};

// ========== УПРАВЛЕНИЕ ГЛАВНОЙ СТРАНИЦЕЙ ==========
exports.getHomeEdit = async (req, res) => {
    try {
        const [texts] = await db.query('SELECT * FROM site_settings WHERE category IN ("hero", "about", "geo")');
        const [slides] = await db.query('SELECT * FROM home_slider ORDER BY order_index');
        const [advantages] = await db.query('SELECT * FROM advantages ORDER BY order_index');
        const [partners] = await db.query('SELECT * FROM partners');
        res.render('admin/home_edit', { title: 'Управление главной', texts, slides, advantages, partners });
    } catch (err) {
        res.status(500).send('Ошибка');
    }
};

// ========== УПРАВЛЕНИЕ ПРОЕКТАМИ (ПОРТФОЛИО) ==========
exports.getProjectsEdit = async (req, res) => {
    try {
        const [projects] = await db.query('SELECT * FROM projects ORDER BY year DESC');
        res.render('admin/projects_edit', { title: 'Управление проектами', projects });
    } catch (err) {
        res.status(500).send('Ошибка');
    }
};

exports.addProject = async (req, res) => {
    const { year, title, object_type, image_url } = req.body;
    const slug = `projects-${year}-${Date.now()}`;
    try {
        await db.query('INSERT INTO projects (year, title, object_type, image_url, slug) VALUES (?, ?, ?, ?, ?)',
            [year, title, object_type, image_url || 'project-placeholder.jpg', slug]);
        res.redirect('/admin/projects?success=1');
    } catch (err) {
        res.status(500).send('Ошибка');
    }
};

exports.deleteProject = async (req, res) => {
    try {
        await db.query('DELETE FROM projects WHERE id = ?', [req.params.id]);
        res.redirect('/admin/projects?deleted=1');
    } catch (err) {
        res.status(500).send('Ошибка');
    }
};

// ========== УПРАВЛЕНИЕ КОНТАКТАМИ ==========
exports.getContactsEdit = async (req, res) => {
    try {
        const [texts] = await db.query('SELECT * FROM site_settings WHERE category = "contacts"');
        res.render('admin/contacts_edit', { title: 'Управление контактами', texts });
    } catch (err) {
        res.status(500).send('Ошибка');
    }
};

exports.updateContacts = async (req, res) => {
    const updates = req.body;
    try {
        for (let key in updates) {
            await db.query('UPDATE site_settings SET setting_value = ? WHERE setting_key = ?', [updates[key], key]);
        }
        res.redirect('/admin/contacts?success=1');
    } catch (err) {
        res.status(500).send('Ошибка');
    }
};

// ========== УПРАВЛЕНИЕ ТЕКСТАМИ (КОНТЕНТ) ==========
exports.getContentEdit = async (req, res) => {
    const [settings] = await db.query('SELECT * FROM site_settings');
    res.render('admin/content', { title: 'Управление текстами', settings });
};

exports.updateContent = async (req, res) => {
    const updates = req.body;
    try {
        for (let key in updates) {
            await db.query('UPDATE site_settings SET setting_value = ? WHERE setting_key = ?', [updates[key], key]);
        }
        res.redirect('/admin/content');
    } catch (err) {
        res.status(500).send('Ошибка');
    }
};

// ========== СООБЩЕНИЯ ПОЛЬЗОВАТЕЛЕЙ ==========
exports.getMessages = async (req, res) => {
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
};

exports.updateMessageStatus = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    try {
        await db.query('UPDATE contact_messages SET status = ? WHERE id = ?', [status, id]);
        res.redirect('/admin/messages');
    } catch (error) {
        res.status(500).send('Ошибка при обновлении статуса');
    }
};

exports.answerMessage = async (req, res) => {
    const { id } = req.params;
    const { admin_answer } = req.body;
    try {
        await db.query('UPDATE contact_messages SET admin_answer = ?, status = "completed" WHERE id = ?',
            [admin_answer, id]);
        res.redirect('/admin/messages?success=answer');
    } catch (error) {
        console.error(error);
        res.status(500).send('Ошибка при сохранении ответа');
    }
};

// ========== СЕРТИФИКАТЫ ==========
exports.getCertificates = async (req, res) => {
    try {
        const [certificates] = await db.query('SELECT * FROM certificates ORDER BY order_index ASC');
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
};

// ========== ПОЛЬЗОВАТЕЛИ ==========
exports.getUsers = async (req, res) => {
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
};

exports.getUserEdit = async (req, res) => {
    try {
        const userId = req.params.id;

        const [users] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
        if (users.length === 0) {
            return res.status(404).send('Пользователь не найден');
        }

        const user = users[0];

        const [quizResults] = await db.query('SELECT * FROM quiz_results WHERE user_id = ? ORDER BY created_at DESC', [userId]);
        const [messages] = await db.query('SELECT * FROM contact_messages WHERE email = ? ORDER BY created_at DESC', [user.email]);
        const [callbacks] = await db.query('SELECT * FROM callbacks WHERE phone = ? ORDER BY created_at DESC', [user.phone || '']);

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
};

exports.updateUser = async (req, res) => {
    const userId = req.params.id;
    const { full_name, email, phone, role, is_blocked } = req.body;

    if (userId == req.session.user.id && role !== req.session.user.role) {
        return res.redirect(`/admin/users/${userId}/edit?error=Нельзя изменить свою роль`);
    }

    try {
        await db.query('UPDATE users SET full_name = ?, email = ?, phone = ?, role = ?, is_blocked = ? WHERE id = ?',
            [full_name, email, phone || null, role, is_blocked === 'on' ? 1 : 0, userId]);
        res.redirect(`/admin/users/${userId}/edit?success=1`);
    } catch (err) {
        console.error('Ошибка обновления:', err);
        res.redirect(`/admin/users/${userId}/edit?error=1`);
    }
};

exports.resetUserPassword = async (req, res) => {
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
};

exports.deleteUser = async (req, res) => {
    const userId = req.params.id;

    if (userId == req.session.user.id) {
        return res.redirect('/admin/users?error=Нельзя удалить самого себя');
    }

    try {
        const [users] = await db.query('SELECT role FROM users WHERE id = ?', [userId]);
        if (users.length > 0 && users[0].role === 'admin') {
            return res.redirect('/admin/users?error=Нельзя удалить администратора');
        }

        await db.query('DELETE FROM quiz_results WHERE user_id = ?', [userId]);
        await db.query('DELETE FROM users WHERE id = ?', [userId]);

        res.redirect('/admin/users?success=Пользователь удален');
    } catch (err) {
        console.error('Ошибка удаления:', err);
        res.redirect('/admin/users?error=Ошибка при удалении');
    }
};

// ========== УПРАВЛЕНИЕ ПРОЕКТАМИ КЛИЕНТОВ (USER-PROJECTS) ==========

// Список всех проектов клиентов
exports.getUserProjects = async (req, res) => {
    try {
        const [projects] = await db.query(`
            SELECT p.*, u.full_name as user_name, u.email as user_email, s.title as service_title
            FROM user_projects p
            LEFT JOIN users u ON p.user_id = u.id
            LEFT JOIN services s ON p.service_id = s.id
            ORDER BY p.created_at DESC
        `);

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
};

// Страница создания проекта (выбор пользователя)
exports.getCreateUserProject = async (req, res) => {
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
};

// Создание проекта
exports.createUserProject = async (req, res) => {
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
};

// Детальная страница проекта
exports.getUserProjectDetail = async (req, res) => {
    const projectId = req.params.id;

    try {
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

        const [messages] = await db.query(`
            SELECT m.*, u.full_name as user_name
            FROM project_messages m
            LEFT JOIN users u ON m.user_id = u.id
            WHERE m.project_id = ?
            ORDER BY m.created_at ASC
        `, [projectId]);

        const [photos] = await db.query(
            'SELECT * FROM project_photos WHERE project_id = ? ORDER BY created_at DESC',
            [projectId]
        );

        const [documents] = await db.query(
            'SELECT * FROM project_documents WHERE project_id = ? ORDER BY created_at DESC',
            [projectId]
        );

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
};

// Обновление статуса проекта
exports.updateUserProjectStatus = async (req, res) => {
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
};

// Обновление названия и адреса проекта
exports.updateUserProject = async (req, res) => {
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
};

// Добавление сообщения от админа в проект
exports.addUserProjectMessage = async (req, res) => {
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
};

// Добавление фото в проект
exports.addUserProjectPhoto = async (req, res) => {
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
};

// Удаление фото из проекта
exports.deleteUserProjectPhoto = async (req, res) => {
    const photoId = req.params.photoId;

    try {
        const [photos] = await db.query('SELECT * FROM project_photos WHERE id = ?', [photoId]);
        if (photos.length > 0) {
            const filePath = path.join(__dirname, '..', 'public', photos[0].image_url);
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
};

// Добавление документа в проект
exports.addUserProjectDocument = async (req, res) => {
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
};

// Удаление документа из проекта
exports.deleteUserProjectDocument = async (req, res) => {
    const docId = req.params.docId;

    try {
        const [docs] = await db.query('SELECT * FROM project_documents WHERE id = ?', [docId]);
        if (docs.length > 0) {
            const filePath = path.join(__dirname, '..', 'public', docs[0].file_url);
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
};

// Удаление проекта
exports.deleteUserProject = async (req, res) => {
    const projectId = req.params.id;

    try {
        const [photos] = await db.query('SELECT * FROM project_photos WHERE project_id = ?', [projectId]);
        for (const photo of photos) {
            const filePath = path.join(__dirname, '..', 'public', photo.image_url);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }

        const [docs] = await db.query('SELECT * FROM project_documents WHERE project_id = ?', [projectId]);
        for (const doc of docs) {
            const filePath = path.join(__dirname, '..', 'public', doc.file_url);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }

        await db.query('DELETE FROM user_projects WHERE id = ?', [projectId]);
        res.redirect('/admin/user-projects?success=Проект удален');
    } catch (err) {
        console.error('Ошибка:', err);
        res.redirect(`/admin/user-projects/${projectId}?error=Ошибка при удалении`);
    }
};

// ========== УПРАВЛЕНИЕ ЗАЯВКАМИ НА УСЛУГИ ==========

// Список заявок на услуги
exports.getServiceOrders = async (req, res) => {
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
};

// Одобрение заявки и создание проекта
exports.approveServiceOrder = async (req, res) => {
    const orderId = req.params.id;

    try {
        const [orders] = await db.query('SELECT * FROM service_orders WHERE id = ?', [orderId]);
        if (orders.length === 0) {
            return res.redirect('/admin/service-orders?error=Заявка не найдена');
        }

        const order = orders[0];

        if (order.project_id) {
            return res.redirect('/admin/service-orders?error=Проект для этой заявки уже создан');
        }

        let userId = order.user_id;

        if (!userId) {
            const [users] = await db.query('SELECT id FROM users WHERE email = ?', [order.email]);

            if (users.length > 0) {
                userId = users[0].id;
            } else {
                const username = order.email.split('@')[0] + '_' + Date.now();
                const hashedPassword = await bcrypt.hash('user123456', 10);

                const [result] = await db.query(
                    'INSERT INTO users (username, full_name, email, phone, password, role) VALUES (?, ?, ?, ?, ?, ?)',
                    [username, order.name, order.email, order.phone, hashedPassword, 'user']
                );
                userId = result.insertId;
            }
        }

        const projectTitle = `${order.service_title} - ${order.name}`;

        const [projectResult] = await db.query(
            `INSERT INTO user_projects (user_id, service_id, title, address, status, created_at) 
             VALUES (?, ?, ?, ?, 'approved', NOW())`,
            [userId, order.service_id, projectTitle, null]
        );

        const projectId = projectResult.insertId;

        await db.query(
            'UPDATE service_orders SET status = "approved", project_id = ? WHERE id = ?',
            [projectId, orderId]
        );

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
};

// Отклонение заявки
exports.rejectServiceOrder = async (req, res) => {
    const orderId = req.params.id;

    try {
        await db.query('UPDATE service_orders SET status = "rejected" WHERE id = ?', [orderId]);
        res.redirect('/admin/service-orders?success=Заявка отклонена');
    } catch (err) {
        console.error('Ошибка:', err);
        res.redirect('/admin/service-orders?error=Ошибка');
    }
};

// Удаление заявки
exports.deleteServiceOrder = async (req, res) => {
    const orderId = req.params.id;

    try {
        await db.query('DELETE FROM service_orders WHERE id = ?', [orderId]);
        res.redirect('/admin/service-orders?success=Заявка удалена');
    } catch (err) {
        console.error('Ошибка:', err);
        res.redirect('/admin/service-orders?error=Ошибка');
    }
};

// ========== ДЕТАЛЬНЫЕ ПРОЕКТЫ (ПОРТФОЛИО, АДМИН) ==========

// Страница управления детальным проектом
exports.getProjectDetailEdit = async (req, res) => {
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
};

// Сохранение детального описания проекта
exports.saveProjectDetail = async (req, res) => {
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
};

// Добавление события в таймлайн
exports.addTimelineEvent = async (req, res) => {
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
};

// Удаление события из таймлайна
exports.deleteTimelineEvent = async (req, res) => {
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
};

// Добавление фото в детальный проект
exports.addProjectDetailPhoto = async (req, res) => {
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
};

// Удаление фото из детального проекта
exports.deleteProjectDetailPhoto = async (req, res) => {
    const photoId = req.params.id;

    try {
        const [photo] = await db.query('SELECT * FROM project_detail_photos WHERE id = ?', [photoId]);

        if (photo[0] && photo[0].image_url) {
            const filePath = path.join(__dirname, '..', 'public', 'img', photo[0].image_url);
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
};

// ========== СОЗДАНИЕ НОВОГО ПОЛЬЗОВАТЕЛЯ (для менеджера) ==========
exports.createUser = async (req, res) => {
    const { username, full_name, email, phone, password, role } = req.body;

    if (!username || !full_name || !email || !password) {
        return res.redirect('/admin/users?error=Заполните все обязательные поля');
    }

    try {
        // Проверяем, не существует ли пользователь
        const [existing] = await db.query(
            'SELECT id FROM users WHERE username = ? OR email = ?',
            [username, email]
        );

        if (existing.length > 0) {
            return res.redirect('/admin/users?error=Пользователь с таким логином или email уже существует');
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        // Менеджер может создавать только пользователей с ролью 'user' или 'manager'
        let newRole = 'user';
        if (req.session.user.role === 'admin') {
            newRole = role || 'user';
        } else if (req.session.user.role === 'manager') {
            newRole = 'user'; // Менеджер не может создавать других менеджеров
        }

        await db.query(
            'INSERT INTO users (username, full_name, email, phone, password, role) VALUES (?, ?, ?, ?, ?, ?)',
            [username, full_name, email, phone || null, hashedPassword, newRole]
        );

        res.redirect('/admin/users?success=Пользователь создан');
    } catch (err) {
        console.error('Ошибка создания пользователя:', err);
        res.redirect('/admin/users?error=Ошибка при создании');
    }
};

// ========== ИСТОРИЯ ЧАТОВ ==========
exports.getChatHistory = async (req, res) => {
    try {
        const [messages] = await db.query('SELECT * FROM chat_messages ORDER BY created_at DESC LIMIT 100');
        res.render('admin/chat', {
            title: 'История чатов | Админ',
            messages: messages
        });
    } catch (err) {
        console.error('Ошибка:', err);
        res.status(500).send('Ошибка загрузки');
    }
};

// ========== ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ ДЛЯ УСЛУГ (которые отсутствуют) ==========

// Страница редактирования услуги
exports.getServiceEdit = async (req, res) => {
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
            } catch (e) { additionalImages = []; }
        }

        res.render('admin/service_edit', {
            title: 'Редактирование услуги | Админ',
            service: service,
            additionalImages: additionalImages,
            error: req.query.error
        });
    } catch (err) {
        console.error('Ошибка:', err);
        res.status(500).send('Ошибка загрузки');
    }
};

// Обновление услуги с загрузкой фото
exports.updateService = async (req, res) => {
    const { title, description, full_description, price, seo_title, seo_description } = req.body;
    const serviceId = req.params.id;

    try {
        const [services] = await db.query('SELECT * FROM services WHERE id = ?', [serviceId]);
        if (services.length === 0) {
            return res.redirect('/admin/services?error=notfound');
        }
        const currentService = services[0];

        let image_url = currentService.image_url;
        let images_json = currentService.images_json;

        const files = req.files || {};

        if (files.main_image && files.main_image[0]) {
            if (image_url && image_url !== '') {
                const oldImagePath = path.join(__dirname, '..', 'public', 'img', image_url);
                if (fs.existsSync(oldImagePath)) {
                    fs.unlinkSync(oldImagePath);
                }
            }
            image_url = files.main_image[0].filename;
        }

        if (files.additional_images && files.additional_images.length > 0) {
            let currentImages = [];
            if (images_json && images_json !== '') {
                try {
                    currentImages = JSON.parse(images_json);
                } catch (e) { currentImages = []; }
            }
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
};

// ========== МЕТОДЫ ДЛЯ СЕРТИФИКАТОВ (которые отсутствуют) ==========

// Добавление сертификата
exports.addCertificate = async (req, res) => {
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
};

// Обновление сертификата
exports.updateCertificate = async (req, res) => {
    const { id } = req.params;
    const { title, is_active, existing_image } = req.body;

    let image_url = existing_image;

    if (req.file) {
        if (existing_image) {
            const oldPath = path.join(__dirname, '..', 'public', 'img', existing_image);
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
};

// Удаление сертификата
exports.deleteCertificate = async (req, res) => {
    const { id } = req.params;

    try {
        const [cert] = await db.query('SELECT image_url FROM certificates WHERE id = ?', [id]);
        if (cert[0] && cert[0].image_url) {
            const filePath = path.join(__dirname, '..', 'public', 'img', cert[0].image_url);
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
};

// Сортировка сертификатов
exports.reorderCertificates = async (req, res) => {
    const { order } = req.body;

    try {
        for (let i = 0; i < order.length; i++) {
            await db.query('UPDATE certificates SET order_index = ? WHERE id = ?', [i, order[i]]);
        }
        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка сортировки:', err);
        res.status(500).json({ error: 'Ошибка' });
    }
};