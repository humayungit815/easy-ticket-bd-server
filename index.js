require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const port = process.env.PORT || 3000;

// middleware
app.use(
	cors({
		origin: [`${process.env.CLIENT_DOMAIN}`],
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
		const bookingsCollection = db.collection("bookings");

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

		// payment
		app.post("/create-checkout-session", async (req, res) => {
			const paymentInfo = req.body;

			const session = await stripe.checkout.sessions.create({
				payment_method_types: ["card"],
				line_items: [
					{
						price_data: {
							currency: "usd",
							product_data: {
								name: paymentInfo.ticketTitle,
								images: [paymentInfo.image],
							},
							unit_amount: Math.round(paymentInfo.totalPrice * 100), // cents
						},
						quantity: paymentInfo.bookingQty,
					},
				],
				customer_email: paymentInfo.customer.email,
				mode: "payment",
				success_url: `${process.env.CLIENT_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
				cancel_url: `${process.env.CLIENT_DOMAIN}/my-bookings`,
			});

			res.send({url: session.url});
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

		// ticket details
		app.get("/tickets/:id", async (req, res) => {
			try {
				const id = req.params.id;
				const ticket = await ticketsCollection.findOne({_id: new ObjectId(id)});
				if (!ticket) {
					return res.status(404).send({error: "Ticket not found"});
				}
				res.send(ticket);
			} catch (error) {
				console.error(error);
				res.status(500).send({error: "Internal Server Error"});
			}
		});

		// bookings ticket
		app.post("/bookings", async (req, res) => {
			const bookingData = req.body;

			// Set initial booking status
			bookingData.status = "pending"; // pending | accepted | rejected | paid
			bookingData.createdAt = new Date();

			try {
				const result = await bookingsCollection.insertOne(bookingData);
				res.send(result);
			} catch (error) {
				console.error(error);
				res.status(500).send({message: "Booking failed"});
			}
		});

		// my booked ticktes
		// GET /my-bookings
		app.get("/bookings", async (req, res) => {
			const email = req.query.email;
			try {
				if (!email) {
					return res
						.status(400)
						.send({error: "Email query parameter is required"});
				}

				const bookings = await bookingsCollection
					.find({userEmail: email})
					.toArray();
				res.send(bookings);
			} catch (err) {
				console.error(err);
				res.status(500).send({error: "Failed to fetch bookings"});
			}
		});

		// booking status update
		// Accept booking request
		app.patch("/bookings/accept/:id", async (req, res) => {
			const id = req.params.id;
			const result = await bookingsCollection.updateOne(
				{_id: new ObjectId(id)},
				{$set: {status: "accepted"}}
			);
			res.send(result);
		});

		// Reject booking request
		app.patch("/bookings/reject/:id", async (req, res) => {
			const id = req.params.id;
			const result = await bookingsCollection.updateOne(
				{_id: new ObjectId(id)},
				{$set: {status: "rejected"}}
			);
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
