import mongoose from 'mongoose';

const driverWalletSchema = new mongoose.Schema({
    driverId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Driver',
        required: true,
        unique: true
    },
    balance: {
        type: Number,
        default: 0
    },
    todayCollection: {
        type: Number,
        default: 0
    },
    weeklyCollection: {
        type: Number,
        default: 0
    },
    totalCollection: {
        type: Number,
        default: 0
    },
    lastCollectionDate: {
        type: Date,
        default: Date.now
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

driverWalletSchema.pre('save', function (next) {
    this.updatedAt = Date.now();
    next();
});

export default mongoose.model('DriverWallet', driverWalletSchema);
