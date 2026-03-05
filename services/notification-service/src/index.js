import express from 'express';
import routes from './routes.js';

const app = express();
app.use(express.json());

app.use("/", routes);

const PORT= 4000;

app.listen(PORT, ()=>{
    console.log(`Service run on port ${PORT}`);
})