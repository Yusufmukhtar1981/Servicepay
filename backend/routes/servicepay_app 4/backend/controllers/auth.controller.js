exports.loginUser = async (req, res) => {
  try {
    const { phone, email, identifier, password } = req.body;

    // Zai karɓi email, phone ko identifier daga Admin app.
    const loginValue = email || phone || identifier;

    if (!loginValue || !password) {
      return res.status(400).json({
        success: false,
        message: "Email or phone and password are required.",
      });
    }

    const cleanLoginValue = String(loginValue).trim();
    const normalizedEmail = cleanLoginValue.toLowerCase();

    const user = await User.findOne({
      $or: [
        { email: normalizedEmail },
        { phone: cleanLoginValue },
      ],
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid login details.",
      });
    }

    if (user.status !== "ACTIVE") {
      return res.status(403).json({
        success: false,
        message: "Wannan account din ba ya aiki a halin yanzu.",
      });
    }

    let passwordIsCorrect = false;

    // Idan password bcrypt hash ne.
    if (
      typeof user.password === "string" &&
      (user.password.startsWith("$2a$") ||
        user.password.startsWith("$2b$") ||
        user.password.startsWith("$2y$"))
    ) {
      passwordIsCorrect = await user.comparePassword(password);
    } else {
      // Gyaran tsohon plain-text password sau ɗaya.
      passwordIsCorrect = password === user.password;

      if (passwordIsCorrect) {
        user.password = password;

        // user.model.js pre-save hook zai hash password ɗin.
        await user.save();

        console.log(`Password migrated to bcrypt for ${user.email || user.phone}`);
      }
    }

    if (!passwordIsCorrect) {
      return res.status(401).json({
        success: false,
        message: "Invalid login details.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Login successful.",
      token: generateToken(user._id),
      user: formatUser(user),
    });
  } catch (error) {
    console.error("Login error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to login.",
      error: error.message,
    });
  }
};