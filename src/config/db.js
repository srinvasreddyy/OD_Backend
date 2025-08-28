import mongoose from "mongoose";   

const DBconnection = async ()=>{
    try {
       const connectionInstance = await mongoose.connect("mongodb+srv://srinivasreddy:9381619147@odbackend.5pkpowq.mongodb.net");
        console.log(`\n MongoDB connected Host : ${connectionInstance.connection.host}`)
    } catch (error) {
        console.log("MongoDB error",error)
        process.exit(1)
    }
}
export default DBconnection