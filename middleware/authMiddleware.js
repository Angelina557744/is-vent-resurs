exports.isAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') {
        return next();
    }
    return res.status(403).send('Нет доступа. Только для администратора.');
};

exports.isManager = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'manager') {
        return next();
    }
    return res.status(403).send('Нет доступа. Только для менеджера.');
};

exports.isAdminOrManager = (req, res, next) => {
    if (req.session.user && (req.session.user.role === 'admin' || req.session.user.role === 'manager')) {
        return next();
    }
    return res.status(403).send('Нет доступа. Только для сотрудников.');
};

exports.isAuth = (req, res, next) => {
    if (req.session && req.session.user) {
        return next();
    }
    return res.redirect('/login');
};