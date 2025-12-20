require("dotenv").config();
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const app = express();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 3000;
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
	"utf-8"
);
const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
	credential: admin.credential.cert(serviceAccount),
});

// middleware
app.use(
	cors({
		origin: [`${process.env.CLIENT_DOMAIN}`],
		credentials: true,
	})
);
app.use(express.json());

// jwt middlewares
const verifyJWT = async (req, res, next) => {
	const token = req?.headers?.authorization?.split(" ")[1];
	console.log(token);
	if (!token) return res.status(401).send({message: "Unauthorized Access!"});
	try {
		const decoded = await admin.auth().verifyIdToken(token);
		req.tokenEmail = decoded.email;
		console.log(decoded);
		next();
	} catch (err) {
		console.log(err);
		return res.status(401).send({message: "Unauthorized Access!", err});
	}
};

const {MongoClient, ServerApiVersion, ObjectId} = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster0.ulplndh.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
	serverApi: {
		version: ServerApiVersion.v1,
		strict: true,
		deprecationErrors: true,
	},
});

async function run() {
	try {
		const db = client.db("easyTicketBD");
		const ticketsCollection = db.collection("tickets");
		const usersCollection = db.collection("users");
		const bookingsCollection = db.collection("bookings");
		const transactionsCollection = db.collection("transactions");

		// latest added tickets
		app.get("/recent-added", async (req, res) => {
			const result = await ticketsCollection
				.find({verificationStatus: "approved"})
				.sort({createdAt: -1})
				.limit(6)
				.toArray();
			res.send(result);
		});

		// Admin: get approved tickets
		app.get("/admin/approved-tickets", async (req, res) => {
			const tickets = await ticketsCollection
				.find({
					verificationStatus: "approved",
					isHidden: {$ne: true},
				})
				.toArray();

			res.send(tickets);
		});

		app.patch("/admin/advertise/:id", async (req, res) => {
			try {
				const id = req.params.id;

				const ticket = await ticketsCollection.findOne({
					_id: new ObjectId(id),
				});
				if (!ticket) return res.status(404).send({error: "Ticket not found"});

				if (!ticket.isAdvertised) {
					const advertisedCount = await ticketsCollection.countDocuments({
						isAdvertised: true,
					});

					if (advertisedCount >= 6) {
						return res.status(400).send({
							error: "Maximum 6 tickets can be advertised",
						});
					}
				}

				// toggle advertise
				const result = await ticketsCollection.updateOne(
					{_id: new ObjectId(id)},
					{$set: {isAdvertised: !ticket.isAdvertised}}
				);

				res.send({success: true});
			} catch (err) {
				res.status(500).send({error: err.message});
			}
		});

		app.get("/advertised-tickets", async (req, res) => {
			const tickets = await ticketsCollection
				.find({
					isAdvertised: true,
					verificationStatus: "approved",
				})
				.toArray();

			res.send(tickets);
		});

		// get all users(admin only)
		app.get("/users", async (req, res) => {
			const users = await usersCollection.find().toArray();
			res.send(users);
		});

		// approve admin
		app.patch("/approve-admin/:email", verifyJWT, async (req, res) => {
			try {
				const email = req.params.email;

				
				const result = await usersCollection.updateOne(
					{email: email},
					{$set: {role: "admin"}}
				);

				if (result.matchedCount === 0) {
					return res.status(404).send({error: "User not found"});
				}

				res.send({success: true, modifiedCount: result.modifiedCount});
			} catch (err) {
				console.error(err);
				res.status(500).send({error: err.message});
			}
		});

		// make vendor
		app.patch("/approve-vendor/:email", verifyJWT, async (req, res) => {
			try {
				const email = req.params.email;

				// Update user role to 'admin'
				const result = await usersCollection.updateOne(
					{email: email},
					{$set: {role: "vendor"}}
				);

				if (result.matchedCount === 0) {
					return res.status(404).send({error: "User not found"});
				}

				res.send({success: true, modifiedCount: result.modifiedCount});
			} catch (err) {
				console.error(err);
				res.status(500).send({error: err.message});
			}
		});

		// Mark vendor as fraud
		app.patch("/users/fraud/:id", async (req, res) => {
			try {
				const id = req.params.id;

				// 1️⃣ Find the user
				const vendor = await usersCollection.findOne({_id: new ObjectId(id)});

				if (!vendor || vendor.role !== "vendor") {
					return res.status(400).send({error: "Not a vendor"});
				}

				// 2️⃣ Mark as fraud
				await usersCollection.updateOne(
					{_id: new ObjectId(id)},
					{$set: {isFraud: true}}
				);

				// 3️⃣ Hide all vendor tickets
				await ticketsCollection.updateMany(
					{vendorEmail: vendor.email},
					{$set: {isHidden: true}}
				);

				res.send({success: true});
			} catch (err) {
				console.error(err);
				res.status(500).send({error: err.message});
			}
		});

		app.post("/tickets", async (req, res) => {
			const ticket = req.body;
			const result = await ticketsCollection.insertOne(ticket);
			res.send(result);
		});

		// get all tickets with search & filter
		app.get("/tickets", async (req, res) => {
			try {
				const {page = 1, limit = 6, from, to, transportType} = req.query;
				// const {from, to, transportType} = req.query;

				const query = {verificationStatus: "approved"};

				// 🔍 From Location
				if (from) {
					query.fromLocation = {$regex: from, $options: "i"};
				}

				// 🔍 To Location
				if (to) {
					query.toLocation = {$regex: to, $options: "i"};
				}

				// 🎛 Transport Type filter
				if (transportType && transportType !== "all") {
					query.transportType = transportType;
				}

				const skip = (parseInt(page) - 1) * parseInt(limit);

				const tickets = await ticketsCollection
					.find(query)
					.skip(skip)
					.limit(parseInt(limit))
					.toArray();

				const totalTickets = await ticketsCollection.countDocuments(query);

				res.send({
					tickets,
					totalTickets,
					totalPages: Math.ceil(totalTickets / parseInt(limit)),
					currentPage: parseInt(page),
				});
			} catch (err) {
				res.status(500).send({error: err.message});
			}
		});

		// find vendor added tickets
		app.get("/vendor/my-tickets", verifyJWT, async (req, res) => {
			try {
				const vendorEmail = req.tokenEmail;
				if (!vendorEmail)
					return res.status(400).send({error: "Vendor email required"});

				const tickets = await ticketsCollection
					.find({vendorEmail: vendorEmail})
					.toArray();

				res.send(tickets);
			} catch (err) {
				res.status(500).send({error: err.message});
			}
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
		app.get("/users/role", verifyJWT, async (req, res) => {
			const result = await usersCollection.findOne({email: req.tokenEmail});
			res.send({role: result?.role});
		});

		// payment
		app.post("/create-checkout-session", async (req, res) => {
			try {
				const paymentInfo = req.body;

				if (
					!paymentInfo.bookingId ||
					!paymentInfo.totalPrice ||
					!paymentInfo.bookingQty
				) {
					return res.status(400).send({error: "Missing booking info"});
				}

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
							quantity: Number(paymentInfo.bookingQty),
						},
					],
					customer_email: paymentInfo.customer.email,
					mode: "payment",
					metadata: {
						bookingId: paymentInfo.bookingId.toString(),
						ticketQuantity: paymentInfo.bookingQty.toString(),
					},
					success_url: `${process.env.CLIENT_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
					cancel_url: `${process.env.CLIENT_DOMAIN}/my-bookings`,
				});

				res.send({url: session.url});
			} catch (err) {
				console.error(err);
				res.status(500).send({error: err.message});
			}
		});

		// Handle payment success
		app.post("/payment-success", async (req, res) => {
			try {
				const {sessionId} = req.body;
				if (!sessionId)
					return res.status(400).send({error: "Missing session ID"});

				const session = await stripe.checkout.sessions.retrieve(sessionId);

				// Check if transaction was already processed
				const existingTransaction = await transactionsCollection.findOne({
					transactionId: session.payment_intent,
				});
				if (existingTransaction) {
					return res.send({
						success: true,
						message: "Transaction already processed",
					});
				}

				if (!session || session.payment_status !== "paid") {
					return res.status(400).send({error: "Payment not completed"});
				}

				const bookingId = session.metadata?.bookingId;
				const booking = await bookingsCollection.findOne({
					_id: new ObjectId(bookingId),
				});
				if (!booking) return res.status(404).send({error: "Booking not found"});

				// Update booking status to paid
				await bookingsCollection.updateOne(
					{_id: new ObjectId(bookingId)},
					{
						$set: {
							status: "paid",
							paymentStatus: "paid",
							transactionId: session.payment_intent,
							paidAt: new Date(),
						},
					}
				);
				const soldQty = parseInt(
					booking.bookingQty ||
						booking.ticketQuantity ||
						session.metadata.ticketQuantity ||
						1
				);

				const reduceQuantity = await ticketsCollection.updateOne(
					{_id: new ObjectId(booking.ticketId)},
					{$inc: {quantity: -Math.abs(soldQty)}}
				);

				// Save transaction record
				await transactionsCollection.insertOne({
					userEmail: booking.userEmail,
					vendorEmail: booking.vendorEmail,
					transactionId: session.payment_intent,
					amount: booking.totalPrice,
					ticketTitle: booking.ticketTitle,
					paidAt: new Date(),
				});

				res.send({success: true});
			} catch (err) {
				console.error(err);
				res.status(500).send({error: err.message});
			}
		});

		// GET /vendor/revenue
		app.get("/vendor/revenue", verifyJWT, async (req, res) => {
			try {
				const email = req.tokenEmail;
				if (!email)
					return res.status(400).send({error: "Vendor email required"});

				const transactions = await transactionsCollection
					.find({vendorEmail: email})
					.toArray();

				let totalRevenue = 0;
				let totalTicketsSold = 0;

				console.log("Vendor Email:", email);
				console.log("Transactions:", transactions);

				transactions.forEach(tx => {
					totalRevenue += tx.amount;
					totalTicketsSold += tx.quantity || 1;
				});

				const totalTicketsAdded = await ticketsCollection.countDocuments({
					vendorEmail: email,
				});

				res.send({
					totalRevenue,
					totalTicketsSold,
					totalTicketsAdded,
					transactions, // optional, chart-wise data
				});
			} catch (err) {
				console.error(err);
				res.status(500).send({error: err.message});
			}
		});

		// GET transactions
		app.get("/transactions", verifyJWT, async (req, res) => {
			try {
				const email = req.tokenEmail;
				if (!email) return res.status(400).send({error: "Email is required"});

				const transactions = await transactionsCollection
					.find({userEmail: email})
					.sort({paidAt: -1}) // newest first
					.toArray();

				res.send(transactions);
			} catch (err) {
				console.error(err);
				res.status(500).send({error: "Failed to fetch transactions"});
			}
		});

		// admin manage tickets
		app.get("/admin/tickets", async (req, res) => {
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

			if (!bookingData.ticketId) {
				return res.status(400).send({error: "ticketId is required"});
			}

			// Set initial booking status
			bookingData.status = "pending";
			bookingData.createdAt = new Date();

			try {
				const result = await bookingsCollection.insertOne(bookingData);
				res.send(result);
			} catch (error) {
				console.error(error);
				res.status(500).send({message: "Booking failed"});
			}
		});

		// my booked tickets
		app.get("/bookings", verifyJWT, async (req, res) => {
			const email = req.tokenEmail;
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

		// get requested bookings
		app.get("/vendor/bookings", verifyJWT, async (req, res) => {
			const email = req.tokenEmail;

			const bookings = await bookingsCollection
				.find({vendorEmail: email})
				.toArray();

			res.send(bookings);
		});

		// booking status update
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

		// update tickets
		app.put("/tickets/:id", async (req, res) => {
			const id = req.params.id;
			const updatedData = req.body;

			const filter = {_id: new ObjectId(id)};
			const updateTicket = {
				$set: updatedData,
			};

			const result = await ticketsCollection.updateOne(filter, updateTicket);
			res.send(result);
		});

		// delete tickets
		app.delete("/vendor/delete-ticket/:id", async (req, res) => {
			const id = req.params.id;
			const result = await ticketsCollection.deleteOne({_id: new ObjectId(id)});
			res.send(result);
		});

		// Send a ping to confirm a successful connection
		await client.db("admin").command({ping: 1});
		console.log(
			"Pinged your deployment. You successfully connected to MongoDB!"
		);
	} finally {
	}
}
run().catch(console.dir);

app.get("/", (req, res) => {
	res.send("Hello World!");
});

app.listen(port, () => {
	console.log(`Example app listening on port ${port}`);
});
