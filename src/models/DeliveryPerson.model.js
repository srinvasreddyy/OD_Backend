import mongoose from 'mongoose';

const deliveryPersonSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    contactNumber: {
      type: String,
      required: true,
      match: /^[0-9]{10}$/  // Assumes 10-digit phone numbers
    },
    gender: {
      type: String,
      enum: ['Male', 'Female', 'Other'],
      required: true
    },
    age: {
      type: Number,
      required: true,
      min: 18
    },
    status: {
      type: String,
      enum: ['available', 'busy'],
      default: 'available',
      required: true
    }
  },
  { timestamps: true }
);

const DeliveryPerson = mongoose.model('DeliveryPerson', deliveryPersonSchema);
export default DeliveryPerson;