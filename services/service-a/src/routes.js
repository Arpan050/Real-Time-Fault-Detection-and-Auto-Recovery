import express from 'express';
const router= express.Router();

router.get("/", (req, res)=>{
    res.json({service:"A", status:"Running"});
});

router.post("/health", (req, res)=>{
    res.status(200).json({status:"Healthy"});
});

router.post("/crash", (req, res)=>{
    console.log("Sevice A crashing intentionally");
    process.exit(1);
})

export default router;