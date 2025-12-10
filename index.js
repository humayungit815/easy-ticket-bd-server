const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const port = process.env.PORT || 3000;

// middleware
app.use(
	cors({
		origin: "http://localhost:5173",
		credentials: true,
	})
);
app.use(express.json());

const {MongoClient, ServerApiVersion, ObjectId} = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster0.ulplndh.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
	serverApi: {
		version: ServerApiVersion.v1,
		strict: true,
		deprecationErrors: true,
	},
});

async function run() {
	try {
		// Connect the client to the server	(optional starting in v4.7)
		await client.connect();

		const db = client.db("easyTicketBD");
		const ticketsCollection = db.collection("tickets");
		const usersCollection = db.collection("users");

		app.post("/tickets", async (req, res) => {
			const ticket = req.body;
			const result = await ticketsCollection.insertOne(ticket);
			res.send(result);
		});

		app.get("/tickets", async (req, res) => {
			const result = await ticketsCollection.find().toArray();
			res.send(result);
		});

		// save or update user info
		app.post("/users", async (req, res) => {
			const userData = req.body;

			userData.created_at = new Date().toISOString();
			userData.last_loggedIn = new Date().toISOString();
			userData.role = "user";

			const query = {
				email: userData.email,
			};

			const alreadyExists = await usersCollection.findOne(query);
			console.log("user already exists", alreadyExists);
			if (alreadyExists) {
				const result = await usersCollection.updateOne(query, {
					$set: {
						last_loggedIn: new Date().toISOString(),
					},
				});
				return res.send(result);
			}

			const result = await usersCollection.insertOne(userData);
			res.send(result);
		});

		// get user's role
		app.get("/users/role/:email", async (req, res) => {
			const email = req.params.email;
			const result = await usersCollection.findOne({email});
			res.send({role: result?.role});
		});

		// admin manage tickets
		app.get("/tickets", async (req, res) => {
			const result = await ticketsCollection.find().toArray();
			res.send(result);
		});

		// approve tickets
		app.patch("/approve-tickets/:id", async (req, res) => {
			const id = req.params.id;
			const result = await ticketsCollection.updateOne(
				{_id: new ObjectId(id)},
				{$set: {verificationStatus: "approved"}}
			);
			res.send(result);
		});

		// reject ticket
		app.patch("/reject-tickets/:id", async (req, res) => {
			const id = req.params.id;

			const result = await ticketsCollection.updateOne(
				{_id: new ObjectId(id)},
				{$set: {verificationStatus: "rejected"}}
			);

			res.send(result);
		});

		// only approve ticket get
		app.get("/tickets/approved", async (req, res) => {
			const result = await ticketsCollection
				.find({verificationStatus: "approved"})
				.toArray();

			res.send(result);
		});

		// Send a ping to confirm a successful connection
		await client.db("admin").command({ping: 1});
		console.log(
			"Pinged your deployment. You successfully connected to MongoDB!"
		);
	} finally {
		// Ensures that the client will close when you finish/error
		// await client.close();
	}
}
run().catch(console.dir);

app.get("/", (req, res) => {
	res.send("Hello World!");
});

app.listen(port, () => {
	console.log(`Example app listening on port ${port}`);
});
