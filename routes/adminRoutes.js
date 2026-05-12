const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const adminController = require('../controllers/adminController');
const { isAdmin, isAdminOrManager, isManager } = require('../middleware/authMiddleware');
const { uploadProjectPhoto, uploadProjectDoc } = require('../config/multerConfig');

// Настройка загрузки файлов для сертификатов и фото
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

// ========== ТОЛЬКО ДЛЯ АДМИНА (полный доступ) ==========

// Управление услугами
router.get('/admin/services', isAdmin, adminController.getServices);
router.post('/admin/services/add', isAdmin, adminController.addService);
router.post('/admin/services/delete/:id', isAdmin, adminController.deleteService);
router.get('/admin/services/edit/:id', isAdmin, adminController.getServiceEdit);
router.post('/admin/services/update/:id', isAdmin, upload.fields([
    { name: 'main_image', maxCount: 1 },
    { name: 'additional_images', maxCount: 10 }
]), adminController.updateService);

// Управление главной страницей
router.get('/admin/home', isAdmin, adminController.getHomeEdit);

// Управление контактами
router.get('/admin/contacts', isAdmin, adminController.getContactsEdit);
router.post('/admin/contacts/update', isAdmin, adminController.updateContacts);

// Управление контентом
router.get('/admin/content', isAdmin, adminController.getContentEdit);
router.post('/admin/content/update', isAdmin, adminController.updateContent);

// Управление сертификатами
router.get('/admin/certificates', isAdmin, adminController.getCertificates);
router.post('/admin/certificates/add', isAdmin, upload.single('image'), adminController.addCertificate);
router.post('/admin/certificates/update/:id', isAdmin, upload.single('image'), adminController.updateCertificate);
router.post('/admin/certificates/delete/:id', isAdmin, adminController.deleteCertificate);
router.post('/admin/certificates/reorder', isAdmin, adminController.reorderCertificates);

// Управление портфолио (наши работы)
router.get('/admin/projects', isAdmin, adminController.getProjectsEdit);
router.post('/admin/projects/add', isAdmin, adminController.addProject);
router.post('/admin/projects/delete/:id', isAdmin, adminController.deleteProject);
router.get('/admin/projects/:id/detail', isAdmin, adminController.getProjectDetailEdit);
router.post('/admin/projects/:id/detail/save', isAdmin, adminController.saveProjectDetail);
router.post('/admin/projects/timeline/add', isAdmin, adminController.addTimelineEvent);
router.post('/admin/projects/timeline/:id/delete', isAdmin, adminController.deleteTimelineEvent);
router.post('/admin/projects/photos/add', isAdmin, upload.single('image'), adminController.addProjectDetailPhoto);
router.post('/admin/projects/photos/:id/delete', isAdmin, adminController.deleteProjectDetailPhoto);

// Редактирование пользователей (изменение роли, блокировка)
router.post('/admin/users/:id/update', isAdmin, adminController.updateUser);
router.post('/admin/users/:id/reset-password', isAdmin, adminController.resetUserPassword);
router.post('/admin/users/:id/delete', isAdmin, adminController.deleteUser);

// ========== ДЛЯ АДМИНА И МЕНЕДЖЕРА (работа с клиентами) ==========

// Дашборд (адаптированный под роль)
router.get('/admin', isAdminOrManager, adminController.getDashboard);

// Заявки на звонок
router.get('/admin/callbacks', isAdminOrManager, adminController.getCallbacks);
router.post('/admin/callbacks/update-status/:id', isAdminOrManager, adminController.updateCallbackStatus);

// Сообщения пользователей
router.get('/admin/messages', isAdminOrManager, adminController.getMessages);
router.post('/admin/messages/update-status/:id', isAdminOrManager, adminController.updateMessageStatus);
router.post('/admin/messages/answer/:id', isAdminOrManager, adminController.answerMessage);

// История чатов
router.get('/admin/chat', isAdminOrManager, adminController.getChatHistory);

// Проекты клиентов (полный CRUD)
router.get('/admin/user-projects', isAdminOrManager, adminController.getUserProjects);
router.get('/admin/user-projects/create', isAdminOrManager, adminController.getCreateUserProject);
router.post('/admin/user-projects/create', isAdminOrManager, adminController.createUserProject);
router.get('/admin/user-projects/:id', isAdminOrManager, adminController.getUserProjectDetail);
router.post('/admin/user-projects/:id/status', isAdminOrManager, adminController.updateUserProjectStatus);
router.post('/admin/user-projects/:id/update', isAdminOrManager, adminController.updateUserProject);
router.post('/admin/user-projects/:id/message', isAdminOrManager, adminController.addUserProjectMessage);
router.post('/admin/user-projects/:id/photo', isAdminOrManager, uploadProjectPhoto.single('photo'), adminController.addUserProjectPhoto);
router.post('/admin/user-projects/photo/:photoId/delete', isAdminOrManager, adminController.deleteUserProjectPhoto);
router.post('/admin/user-projects/:id/document', isAdminOrManager, uploadProjectDoc.single('document'), adminController.addUserProjectDocument);
router.post('/admin/user-projects/document/:docId/delete', isAdminOrManager, adminController.deleteUserProjectDocument);
router.post('/admin/user-projects/:id/delete', isAdminOrManager, adminController.deleteUserProject);

// Заявки на услуги
router.get('/admin/service-orders', isAdminOrManager, adminController.getServiceOrders);
router.post('/admin/service-orders/:id/approve', isAdminOrManager, adminController.approveServiceOrder);
router.post('/admin/service-orders/:id/reject', isAdminOrManager, adminController.rejectServiceOrder);
router.post('/admin/service-orders/:id/delete', isAdminOrManager, adminController.deleteServiceOrder);

// Пользователи (просмотр и создание)
router.get('/admin/users', isAdminOrManager, adminController.getUsers);
router.get('/admin/users/:id/edit', isAdminOrManager, adminController.getUserEdit);
router.post('/admin/users/create', isAdminOrManager, adminController.createUser); // НОВЫЙ МАРШРУТ

module.exports = router;