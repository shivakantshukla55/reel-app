const express = require('express');
const mysql = require('mysql2');
const AWS = require('aws-sdk');
const bodyParser = require('body-parser');
const multer = require('multer');
const mongoose = require('mongoose');
const cors = require('cors');

// Initialize app 
const app = express();
app.use(cors());
app.use(bodyParser.json());

// configure MySQL connection
const mysqlConnection = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'root123',
    database: 'short_video_app',
});

mysqlConnection.connect((err) => {
    if (err) {
      console.error('MySQL connection error:', err);
      return;
    }
    console.log('Connected to MySQL database');
});

// configure MongoDB connection
mongoose.connect("mongodb://localhost:27017/reelapp", {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => console.log('Connected to MongoDB'))
.catch((err) => console.error('MongoDB connection error:', err));

// Configure AWS S3
const s3 = new AWS.S3({
    accessKeyId: '*********',
    secretAccessKey: '********',
    region: 'ap-south-1', //'us-east-1',
    signatureVersion: 'v4',
  });

// Multer setup for file uploads
const storage = multer.memoryStorage();
const upload = multer({storage});

// MongoDB schema for video metadata
const videoSchema = new mongoose.Schema({
    videoId: String,
    title: String,
    description: String,
    format: [String],
    resolutions: [String],
    uploadedAt: {type: Date, default: Date.now},
    userId: String,
});

const Video = mongoose.model('Video', videoSchema);

// MySQL setup for user profiles
const createUserTable = `
  CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255),
    email VARCHAR(255),
    country VARCHAR(255)
  );
`;

mysqlConnection.query(createUserTable, (err) => {
    if(err){
        console.error('Error creating MySQL table:', err);
    }else{
        console.log('Users table ensured in MySQL');
    }
});


// CRUD for user profiles
app.post('/users', (req, res) => {
    const {name, email, country} = req.body;

    const query = `INSERT INTO users(name, email, country) VALUES (?, ?, ?)`;
    mysqlConnection.query(query, [name, email, country], (err, results) => {
        if (err) {
            console.error(err);
            res.status(500).json({ message: 'Error creating user' });
        } else {
            res.status(201).json({ message: 'User created successfully', userId: results.insertId });
        }
    })
})

app.get('/users/:id', (req, res) => {
    const { id } = req.params;
    const query = 'SELECT * FROM users WHERE id = ?';
    mysqlConnection.query(query, [id], (err, results) => {
      if (err) {
        console.error(err);
        res.status(500).json({ message: 'Error fetching user' });
      } else if (results.length === 0) {
        res.status(404).json({ message: 'User not found' });
      } else {
        res.status(200).json(results[0]);
      }
    });
});


// Upload Video
app.post("/upload", upload.single("video"), async (req, res) => {
  try {
    const { title, description, userId } = req.body;
    const videoFile = req.file;
    console.log(videoFile, "videoFile")

    if (!videoFile) {
      return res.status(400).json({ message: "No video file uploaded" });
    }

    // Upload video to S3
    const s3Params = {
      Bucket: "reelapp",
      Key: `${Date.now()}_${videoFile.originalname}`,
      Body: videoFile.buffer,
    };

    const s3Response = await s3.upload(s3Params).promise();

    console.log(s3Response, "s3Response");

    // Save video metadata to mongoDB
    const video = new Video({
        videoId: s3Response.Key,
        title,
        description,
        userId,
        format: ['mp4', 'avi'],
        resolutions: ['720p', '1080p'],
    });
    await video.save();

    res.send("Upload Success");
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ message: "Error uploading video", error: err.message });
  }
});

// Get video metadata and playback url
app.get("/video/:id", async (req, res) => {
    try{
        const {id} = req.params;
        const video = await Video.findOne({videoId: id});

        if(!video){
            return res.status(404).json({ message: 'Video not found' });
        }

        const playbackUrl = s3.getSignedUrl('getObject', {
            Bucket: 'reelapp',
            Key: video.videoId,
            Expires: 3600,
        });

        res.status(200).json({video, playbackUrl});
    }catch(err){
        console.error(err);
        res.status(500).json({ message: 'Error retrieving video', error: err.message });
    }
})

// get all reels
app.get("/videos", async (req, res) => {
    try{
        const videos = await Video.find();

        if(!videos){
            return res.status(404).json({ message: 'Video not found' });
        }

        if(videos.length < 1){
            return res.status(200).json({message: "Video list is empty. Please upload some videos"});
        }

        // console.log(videos);

        // res.status(200).json({message: "success"});

        const allVideos = videos.map((video) => {
            const playbackUrl = s3.getSignedUrl('getObject', {
                Bucket: 'reelapp',
                Key: video.videoId,
                Expires: 3600,
            });

            return ({video, playbackUrl});
        });

        res.status(200).json({videos: allVideos, message: "success"});
    }catch(err){
        console.error(err);
        res.status(500).json({ message: 'Error retrieving video', error: err.message });
    }
})

// start the server
const PORT = 3001;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});


