const mongoose = require('mongoose');

const productInfoSchema = new mongoose.Schema({
    productImage: {
        type: String,
        required: true
    },
    productName: {
        type: String,
        required: true
    },
    subtitle1: String,
    subtitle2: String,
    subtitle3: String,
    lastModified: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('ProductInfo', productInfoSchema); 