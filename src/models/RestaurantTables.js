import mongoose from "mongoose";
const restaurantTableSchema = new mongoose.Schema({
  restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant" },
  tableNumber: String,
  capacity: Number,
  area: String,

  availability: [
    {
      day: { 
        type: String, 
        enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
      },
      isAvailable: Boolean,
      openTime: String,
      closeTime: String,
      slots: [
        {
          slotId: String,
          startTime: String,
          endTime: String,
          isBooked: Boolean
        }
      ]
    }
  ],

  isActive: Boolean,
  createdAt: Date,
  updatedAt: Date
});
export default mongoose.model("RestaurantTables", restaurantTableSchema);
