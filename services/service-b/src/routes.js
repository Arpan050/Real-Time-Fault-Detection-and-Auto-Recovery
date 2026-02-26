import express from 'express';

const router= express.Router();

router.get("/", (req, res)=>{
    res.json({Service: "B", Status: "Running"})
})

router.post("/health", (req, res)=>{
    res.status(200).json({Status: "Healthy"})
})

router.post("/crash",(req, res)=>{
    console.log("Service B is crashing intentionally");
    process.exit(1);
})


export default router;