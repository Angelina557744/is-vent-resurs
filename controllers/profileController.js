const db = require('../config/db');

// ========== ЛИЧНЫЙ КАБИНЕТ ==========
exports.getProfile = async (req, res) => {
    try {
        const userId = req.session.user.id;
        
        const [[userData]] = await db.query('SELECT email FROM users WHERE id = ?', [userId]);

        if (!userData) {
            return res.redirect('/logout');
        }

        const [quizResults] = await db.query(
            'SELECT * FROM quiz_results WHERE user_id = ? ORDER BY created_at DESC', 
            [userId]
        );

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
};

// ========== ДЕТАЛЬНЫЙ ПРОСМОТР ПРОЕКТА ==========
exports.getProject = async (req, res) => {
    const projectId = req.params.id;
    const userId = req.session.user.id;
    
    try {
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
        
        const [messages] = await db.query(`
            SELECT m.*, 
                   CASE WHEN m.is_admin = 1 THEN 'Администратор' ELSE ? END as author_name
            FROM project_messages m
            WHERE m.project_id = ?
            ORDER BY m.created_at ASC
        `, [req.session.user.full_name, projectId]);
        
        const [photos] = await db.query(
            'SELECT * FROM project_photos WHERE project_id = ? ORDER BY created_at DESC',
            [projectId]
        );
        
        const [documents] = await db.query(
            'SELECT * FROM project_documents WHERE project_id = ? ORDER BY created_at DESC',
            [projectId]
        );
        
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
            success: req.query.success,
            error: req.query.error
        });
        
    } catch (err) {
        console.error('Ошибка загрузки проекта:', err);
        res.status(500).send('Ошибка загрузки страницы');
    }
};

// ========== ОТПРАВКА СООБЩЕНИЯ ПО ПРОЕКТУ ==========
exports.sendProjectMessage = async (req, res) => {
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
};

// ========== СТРАНИЦА КВИЗА ==========
exports.getQuiz = (req, res) => {
    res.render('quiz', { title: 'Подбор системы вентиляции' });
};