import mongoose from "mongoose";   

const DBconnection = async ()=>{
    try {
       const connectionInstance = await mongoose.connect("mongodb+srv://nanireddy1825:nanireddy1825@cluster0.j1rrqny.mongodb.net/OD-Backend")
        console.log(`\n MongoDB connected Host : ${connectionInstance.connection.host}`)
    } catch (error) {
        console.log("MongoDB error",error)
        process.exit(1)
    }
}
export default DBconnection