// ========== ПРОВЕРКА АДМИНА ==========
exports.isAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') {
        return next();
    }
    return res.status(403).send('Нет доступа. Только для администратора.');
};

// ========== ПРОВЕРКА МЕНЕДЖЕРА ==========
exports.isManager = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'manager') {
        return next();
    }
    return res.status(403).send('Нет доступа. Только для менеджера.');
};

// ========== ПРОВЕРКА АДМИНА ИЛИ МЕНЕДЖЕРА ==========
exports.isAdminOrManager = (req, res, next) => {
    if (req.session.user && (req.session.user.role === 'admin' || req.session.user.role === 'manager')) {
        return next();
    }
    return res.status(403).send('Нет доступа. Только для сотрудников.');
};

// ========== ПРОВЕРКА АВТОРИЗАЦИИ ==========
exports.isAuth = (req, res, next) => {
    if (req.session && req.session.user) {
        return next();
    }
    return res.redirect('/login');
};