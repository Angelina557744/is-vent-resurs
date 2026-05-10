const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const apiController = require('../controllers/apiController');
const { isAuth, isAdmin } = require('../middleware/authMiddleware');
const db = require('../config/db');

// Настройка загрузки файлов
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, '..', 'public', 'img');
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

// ========== API МАРШРУТЫ ==========

// Заявка на услугу
router.post('/api/service-order', apiController.submitServiceOrder);

// Обновление профиля
router.post('/api/profile/update', isAuth, apiController.updateProfile);

// Сохранение результатов квиза
router.post('/api/quiz-save', isAuth, apiController.saveQuizResult);

// Обратный звонок
router.post('/callback', apiController.submitCallback);

// Контактное сообщение
router.post('/api/contact-message', apiController.submitContactMessage);

// Получение сертификатов
router.get('/api/certificates', apiController.getCertificates);

// Чат-бот
router.post('/api/chat/send', apiController.sendChatMessage);

// ========== АДМИНСКИЕ API (которые были в app.js и требуют multer) ==========

// Редактирование услуги (страница)
router.get('/admin/services/edit/:id', isAdmin, async (req, res) => {
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
            error: req.query.error
        });
    } catch (err) {
        console.error('Ошибка:', err);
        res.status(500).send('Ошибка загрузки');
    }
});

// Обновление услуги с загрузкой фото
router.post('/admin/services/update/:id', isAdmin, upload.fields([
    { name: 'main_image', maxCount: 1 },
    { name: 'additional_images', maxCount: 10 }
]), async (req, res) => {
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
                } catch(e) { currentImages = []; }
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
});

// Добавление сертификата
router.post('/admin/certificates/add', isAdmin, upload.single('image'), async (req, res) => {
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

// Обновление сертификата
router.post('/admin/certificates/update/:id', isAdmin, upload.single('image'), async (req, res) => {
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
});

// Удаление сертификата
router.post('/admin/certificates/delete/:id', isAdmin, async (req, res) => {
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
});

// Сортировка сертификатов
router.post('/admin/certificates/reorder', isAdmin, async (req, res) => {
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
});

// Сброс пароля админа (вспомогательный)
router.get('/reset-admin-password', async (req, res) => {
    try {
        const bcrypt = require('bcryptjs');
        const hashedPassword = await bcrypt.hash('adm88@VENT556', 10);
        await db.query('UPDATE users SET password = ? WHERE username = ?', [hashedPassword, 'admin']);
        res.send('Пароль обновлен!');
    } catch (err) {
        res.status(500).send('Ошибка');
    }
});

module.exports = router;