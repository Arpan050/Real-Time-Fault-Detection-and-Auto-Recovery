import express from 'express';

const router= express.Router();

router.get("/",(req, res)=>{
    res.json({Service: "C", Status: "Running"})
})

router.post("/health", (req, res)=>{
    res.json({Status: "Healthy"})
})

router.post("/crash", (req, res)=>{
    console.log("Service C is crashing intentionally");
    process.exit(1);
})

export default router;