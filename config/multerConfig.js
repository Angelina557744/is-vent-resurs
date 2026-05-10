const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Папка для фото проектов
const projectPhotosDir = path.join(__dirname, '..', 'public', 'uploads', 'projects');
if (!fs.existsSync(projectPhotosDir)) {
    fs.mkdirSync(projectPhotosDir, { recursive: true });
}

const projectPhotoStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, projectPhotosDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'project-' + uniqueSuffix + '.jpg');
    }
});

const uploadProjectPhoto = multer({ storage: projectPhotoStorage });

// Папка для документов проектов
const projectDocsDir = path.join(__dirname, '..', 'public', 'uploads', 'projects', 'docs');
if (!fs.existsSync(projectDocsDir)) {
    fs.mkdirSync(projectDocsDir, { recursive: true });
}

const projectDocStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, projectDocsDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = file.originalname.split('.').pop();
        cb(null, 'doc-' + uniqueSuffix + '.' + ext);
    }
});

const uploadProjectDoc = multer({ storage: projectDocStorage });

module.exports = {
    uploadProjectPhoto,
    uploadProjectDoc
};