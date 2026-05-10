const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const adminController = require('../controllers/adminController');
const { isAdmin } = require('../middleware/authMiddleware');

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

// ========== ГОЛОВНАЯ АДМИНКИ ==========
router.get('/admin', isAdmin, adminController.getDashboard);

// ========== ЗАЯВКИ НА ЗВОНОК ==========
router.get('/admin/callbacks', isAdmin, adminController.getCallbacks);
router.post('/admin/callbacks/update-status/:id', isAdmin, adminController.updateCallbackStatus);

// ========== УПРАВЛЕНИЕ УСЛУГАМИ ==========
router.get('/admin/services', isAdmin, adminController.getServices);
router.post('/admin/services/add', isAdmin, adminController.addService);
router.post('/admin/services/delete/:id', isAdmin, adminController.deleteService);

// ========== УПРАВЛЕНИЕ ГЛАВНОЙ ==========
router.get('/admin/home', isAdmin, adminController.getHomeEdit);

// ========== УПРАВЛЕНИЕ ПРОЕКТАМИ (ПОРТФОЛИО) ==========
router.get('/admin/projects', isAdmin, adminController.getProjectsEdit);
router.post('/admin/projects/add', isAdmin, adminController.addProject);
router.post('/admin/projects/delete/:id', isAdmin, adminController.deleteProject);

// ========== УПРАВЛЕНИЕ КОНТАКТАМИ ==========
router.get('/admin/contacts', isAdmin, adminController.getContactsEdit);
router.post('/admin/contacts/update', isAdmin, adminController.updateContacts);

// ========== УПРАВЛЕНИЕ КОНТЕНТОМ ==========
router.get('/admin/content', isAdmin, adminController.getContentEdit);
router.post('/admin/content/update', isAdmin, adminController.updateContent);

// ========== СООБЩЕНИЯ ПОЛЬЗОВАТЕЛЕЙ ==========
router.get('/admin/messages', isAdmin, adminController.getMessages);
router.post('/admin/messages/update-status/:id', isAdmin, adminController.updateMessageStatus);
router.post('/admin/messages/answer/:id', isAdmin, adminController.answerMessage);

// ========== СЕРТИФИКАТЫ ==========
router.get('/admin/certificates', isAdmin, adminController.getCertificates);
router.post('/admin/certificates/add', isAdmin, upload.single('image'), async (req, res) => {
    const { title, is_active } = req.body;
    const db = require('../config/db');
    
    if (!title || !req.file) {
        return res.redirect('/admin/certificates?error=1');
    }
    
    try {
        await db.query('INSERT INTO certificates (title, image_url, is_active) VALUES (?, ?, ?)',
            [title, req.file.filename, is_active === 'on' ? 1 : 0]);
        res.redirect('/admin/certificates?success=1');
    } catch (err) {
        console.error('Ошибка добавления:', err);
        res.redirect('/admin/certificates?error=1');
    }
});
// ========== ИСТОРИЯ ЧАТОВ ==========
router.get('/admin/chat', isAdmin, async (req, res) => {
    try {
        const db = require('../config/db');
        const [messages] = await db.query('SELECT * FROM chat_messages ORDER BY created_at DESC LIMIT 100');
        res.render('admin/chat', {
            title: 'История чатов | Админ',
            messages: messages
        });
    } catch (err) {
        console.error('Ошибка:', err);
        res.status(500).send('Ошибка загрузки');
    }
});
// ========== ПОЛЬЗОВАТЕЛИ ==========
router.get('/admin/users', isAdmin, adminController.getUsers);
router.get('/admin/users/:id/edit', isAdmin, adminController.getUserEdit);
router.post('/admin/users/:id/update', isAdmin, adminController.updateUser);
router.post('/admin/users/:id/reset-password', isAdmin, adminController.resetUserPassword);
router.post('/admin/users/:id/delete', isAdmin, adminController.deleteUser);
// ========== УПРАВЛЕНИЕ ПРОЕКТАМИ КЛИЕНТОВ (USER-PROJECTS) ==========
const { uploadProjectPhoto, uploadProjectDoc } = require('../config/multerConfig');

router.get('/admin/user-projects', isAdmin, adminController.getUserProjects);
router.get('/admin/user-projects/create', isAdmin, adminController.getCreateUserProject);
router.post('/admin/user-projects/create', isAdmin, adminController.createUserProject);
router.get('/admin/user-projects/:id', isAdmin, adminController.getUserProjectDetail);
router.post('/admin/user-projects/:id/status', isAdmin, adminController.updateUserProjectStatus);
router.post('/admin/user-projects/:id/update', isAdmin, adminController.updateUserProject);
router.post('/admin/user-projects/:id/message', isAdmin, adminController.addUserProjectMessage);
router.post('/admin/user-projects/:id/photo', isAdmin, uploadProjectPhoto.single('photo'), adminController.addUserProjectPhoto);
router.post('/admin/user-projects/photo/:photoId/delete', isAdmin, adminController.deleteUserProjectPhoto);
router.post('/admin/user-projects/:id/document', isAdmin, uploadProjectDoc.single('document'), adminController.addUserProjectDocument);
router.post('/admin/user-projects/document/:docId/delete', isAdmin, adminController.deleteUserProjectDocument);
router.post('/admin/user-projects/:id/delete', isAdmin, adminController.deleteUserProject);

// ========== УПРАВЛЕНИЕ ЗАЯВКАМИ НА УСЛУГИ ==========
router.get('/admin/service-orders', isAdmin, adminController.getServiceOrders);
router.post('/admin/service-orders/:id/approve', isAdmin, adminController.approveServiceOrder);
router.post('/admin/service-orders/:id/reject', isAdmin, adminController.rejectServiceOrder);
router.post('/admin/service-orders/:id/delete', isAdmin, adminController.deleteServiceOrder);

// ========== ДЕТАЛЬНЫЕ ПРОЕКТЫ (ПОРТФОЛИО, АДМИН) ==========
router.get('/admin/projects/:id/detail', isAdmin, adminController.getProjectDetailEdit);
router.post('/admin/projects/:id/detail/save', isAdmin, adminController.saveProjectDetail);
router.post('/admin/projects/timeline/add', isAdmin, adminController.addTimelineEvent);
router.post('/admin/projects/timeline/:id/delete', isAdmin, adminController.deleteTimelineEvent);
router.post('/admin/projects/photos/add', isAdmin, upload.single('image'), adminController.addProjectDetailPhoto);
router.post('/admin/projects/photos/:id/delete', isAdmin, adminController.deleteProjectDetailPhoto);

module.exports = router;