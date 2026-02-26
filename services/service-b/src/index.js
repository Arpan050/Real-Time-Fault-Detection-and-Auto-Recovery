import express from 'express';
import routes from './routes.js';

const app = express();
app.use(express.json());

app.use("/", routes);

const PORT=4001;

app.listen(PORT, (req, rse)=>{
    console.log(`service B running in port ${PORT}`);
})