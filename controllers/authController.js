const db = require('../config/db');
const bcrypt = require('bcryptjs');

exports.getRegister = (req, res) => {
    res.render('register', {
        title: 'Регистрация | ВентРесурс'
    });
};

exports.postRegister = async (req, res) => {

    const { username, full_name, email, password } = req.body;

    try {

        const [existing] = await db.query(
            'SELECT id FROM users WHERE username = ? OR email = ?',
            [username, email]
        );

        if (existing.length > 0) {

            return res.render('register', {
                title: 'Регистрация',
                error: 'Данные заняты'
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        await db.query(
            'INSERT INTO users (username, full_name, email, password, role) VALUES (?, ?, ?, ?, ?)',
            [username, full_name, email, hashedPassword, 'user']
        );

        res.redirect('/login');

    } catch (err) {

        console.error(err);

        res.status(500).render('register', {
            title: 'Регистрация',
            error: 'Ошибка регистрации'
        });
    }
};

exports.getLogin = (req, res) => {

    res.render('login', {
        title: 'Вход | ВентРесурс'
    });
};

exports.postLogin = async (req, res) => {

    const { login, password } = req.body;

    try {

        const [users] = await db.query(
            'SELECT * FROM users WHERE username = ?',
            [login]
        );

        if (users.length === 0) {

            return res.render('login', {
                title: 'Вход',
                error: 'Пользователь не найден'
            });
        }

        const user = users[0];

        const isPasswordCorrect = await bcrypt.compare(
            password,
            user.password
        );

        if (isPasswordCorrect) {

            req.session.user = {
                id: user.id,
                username: user.username,
                full_name: user.full_name,
                role: user.role,
                email: user.email,
                phone: user.phone
            };

            req.session.save(() => {

                if (user.role === 'admin') {
                    res.redirect('/admin');
                } else {
                    res.redirect('/profile');
                }
            });

        } else {

            res.render('login', {
                title: 'Вход',
                error: 'Неверный пароль'
            });
        }

    } catch (err) {

        console.error(err);

        res.status(500).send('Ошибка входа');
    }
};

exports.logout = (req, res) => {

    req.session.destroy(() => {
        res.redirect('/');
    });
};