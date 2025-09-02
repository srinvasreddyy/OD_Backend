import mongoose from "mongoose";
const restaurantTableSchema = new mongoose.Schema({
  restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", index: true },
  tableNumber: { type: String, required: true },
  capacity: { type: Number, required: true },
  area: String,
  availability: [
    {
      _id: false,
      day: { 
        type: String, 
        enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
      },
      isAvailable: Boolean,
      openTime: String,
      closeTime: String,
      slots: [
        {
          _id: false,
          slotId: String,
          startTime: String,
          endTime: String,
          isBooked: { type: Boolean, default: false }
        }
      ]
    }
  ],
  isActive: { type: Boolean, default: true },
}, { timestamps: true }); // Added timestamps and removed manual dates

export default mongoose.model("RestaurantTables", restaurantTableSchema);