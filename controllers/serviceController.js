const db = require('../config/db');

// ========== СПИСОК ВСЕХ УСЛУГ ==========
exports.getServices = async (req, res) => {
    try {
        const [services] = await db.query('SELECT * FROM services');
        res.render('services', { 
            title: 'Услуги под ключ | ВентРесурс', 
            services 
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка загрузки услуг');
    }
};

// ========== ОТДЕЛЬНАЯ УСЛУГА ==========
exports.getSingleService = async (req, res) => {
    try {
        const serviceId = req.params.id;
        const [services] = await db.query('SELECT * FROM services WHERE id = ?', [serviceId]);
        
        if (services.length === 0) {
            return res.status(404).render('404', { title: 'Услуга не найдена' });
        }
        
        const service = services[0];
        
        // Парсим дополнительные фото
        let additionalImages = [];
        if (service.images_json && service.images_json !== 'null' && service.images_json !== '') {
            try {
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
};