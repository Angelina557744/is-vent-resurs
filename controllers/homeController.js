const db = require('../config/db');

// Очистка HTML-тегов из контента
function cleanHtmlContent(content) {
    if (!content) return '';
    // Удаляем все HTML-теги
    let cleaned = content.replace(/<[^>]*>/g, '');
    // Заменяем множественные пробелы на один
    cleaned = cleaned.replace(/\s+/g, ' ');
    // Заменяем переносы строк на <br> (чтобы сохранить форматирование)
    cleaned = cleaned.replace(/\n/g, '<br>');
    // Убираем лишние пробелы в начале и конце
    cleaned = cleaned.trim();
    return cleaned;
}

exports.getHomePage = async (req, res) => {
    try {
        const [slides] = await db.query(
            'SELECT * FROM home_slider ORDER BY order_index ASC'
        );

        const [advantages] = await db.query(
            'SELECT * FROM advantages ORDER BY order_index ASC'
        );

        const [reps] = await db.query(
            'SELECT * FROM partners WHERE partner_type = "representative"'
        );

        const [clients] = await db.query(
            'SELECT * FROM partners WHERE partner_type = "client"'
        );

        res.render('index', {
            title: 'Главная | ВентРесурс',
            slides,
            advantages,
            reps,
            clients
        });

    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка загрузки главной страницы');
    }
};

// ========== СТРАНИЦА ПРОЕКТОВ (ПОРТФОЛИО) ==========
exports.getProjects = async (req, res) => {
    try {
        const [projects] = await db.query('SELECT * FROM projects ORDER BY year DESC');
        res.render('projects', { title: 'Наши работы | ВентРесурс', projects });
    } catch (err) {
        console.error('Ошибка портфолио:', err);
        res.status(500).send('Ошибка портфолио');
    }
};

// ========== СТРАНИЦА КОНТАКТОВ ==========
exports.getContacts = (req, res) => {
    res.render('contacts', { title: 'Контакты | ВентРесурс' });
};

// ========== ДЕТАЛЬНАЯ СТРАНИЦА ПРОЕКТА ==========
exports.getProjectDetail = async (req, res) => {
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
            const [rawTimeline] = await db.query(
                'SELECT * FROM project_timeline WHERE project_detail_id = ? ORDER BY display_order ASC',
                [projectDetail.id]
            );

            // ✅ ПРИМЕНЯЕМ ОЧИСТКУ К КАЖДОМУ ЭЛЕМЕНТУ ТАЙМЛАЙНА
            timeline = rawTimeline.map(item => ({
                ...item,
                content: cleanHtmlContent(item.content)
            }));

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
        console.error('Ошибка загрузки проекта:', err);
        res.status(500).send('Ошибка загрузки проекта');
    }
};