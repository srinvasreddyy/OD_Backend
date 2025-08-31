import mongoose from "mongoose";

const DBconnection = async () => {
    try {
        const connectionInstance = await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log(`\n MongoDB connected Host : ${connectionInstance.connection.host}`)
    } catch (error) {
        console.log("MongoDB error", error)
        process.exit(1)
    }
}
export default DBconnection