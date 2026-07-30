require("dotenv").config();
const cloudinary = require("./config/cloudinary");

cloudinary.api
  .ping()
  .then((res) => console.log(res))
  .catch((err) => console.error(err));