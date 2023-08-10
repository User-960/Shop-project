import { Request, Response, Router } from 'express'
import { connection } from '../../..'
import {
	ICommentEntity,
	IProductEntity,
	IProductImageEntity,
	IProductSearchFilter,
	ImagesRemovePayload,
	ProductAddImagesPayload,
	ProductCreatePayload
} from '../../types/types'
import {
	mapCommentsEntity,
	mapImagesEntity,
	mapProductsEntity
} from '../../services/mapping'
import { throwServerError } from '../../utils/error/throwServerError'
import asyncHandler from 'express-async-handler'
import {
	DELETE_IMAGES_QUERY,
	GET_COMMENTS_QUERY,
	GET_IMAGES_QUERY,
	GET_PRODUCTS_QUERY,
	INSERT_PRODUCT_IMAGES_QUERY,
	INSERT_PRODUCT_QUERY,
	getProductsFilterQuery
} from '../../services/queries'
import { enhanceProductsComments } from '../../utils/enhanceProductsComments'
import { v4 as generateId } from 'uuid'
import { ResultSetHeader } from 'mysql2'
import { enhanceProductsImages } from '../../utils/enhanceProductsImages'

export const productsRouter = Router()

// @desc    Get all products
// @route   GET /api/products
// @access  Public
productsRouter.route('/').get(
	asyncHandler(async (req: Request, res: Response) => {
		try {
			const [productRows] = await connection.query<IProductEntity[]>(
				GET_PRODUCTS_QUERY
			)
			const [commentRows] = await connection.query<ICommentEntity[]>(
				GET_COMMENTS_QUERY
			)
			const [imageRows] = await connection.query<IProductImageEntity[]>(
				GET_IMAGES_QUERY
			)

			const products = mapProductsEntity(productRows)
			const withComments = enhanceProductsComments(products, commentRows)
			const withImages = enhanceProductsImages(withComments, imageRows)

			res.send(withImages)
		} catch (e) {
			throwServerError(res, e)
		}
	})
)

// @desc    Get products by filter
// @route   GET /api/products
// @access  Public
productsRouter.route('/search').get(
	asyncHandler(
		async (req: Request<{}, {}, {}, IProductSearchFilter>, res: Response) => {
			try {
				const [query, values] = getProductsFilterQuery(req.query)
				const [rows] = await connection.query<IProductEntity[]>(query, values)

				if (!rows?.length) {
					res.send([])
					return
				}

				const [commentRows] = await connection.query<ICommentEntity[]>(
					'SELECT * FROM comments'
				)
				const [imageRows] = await connection.query<IProductImageEntity[]>(
					'SELECT * FROM images'
				)

				const products = mapProductsEntity(rows)
				const withComments = enhanceProductsComments(products, commentRows)
				const withImages = enhanceProductsImages(withComments, imageRows)

				res.send(withImages)
			} catch (e) {
				throwServerError(res, e)
			}
		}
	)
)

// @desc    Get one product by id
// @route   GET /api/products/:id
// @access  Public
productsRouter.route('/:id').get(
	asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
		try {
			const [rows] = await connection.query<IProductEntity[]>(
				'SELECT * FROM products WHERE product_id = ?',
				[req.params.id]
			)

			if (!rows?.[0]) {
				res.status(404)
				res.send(`Product with id ${req.params.id} is not found`)
				return
			}

			const [comments] = await connection.query<ICommentEntity[]>(
				'SELECT * FROM comments WHERE product_id = ?',
				[req.params.id]
			)

			const [images] = await connection.query<IProductImageEntity[]>(
				'SELECT * FROM images WHERE product_id = ?',
				[req.params.id]
			)

			const product = mapProductsEntity(rows)[0]

			if (comments.length) {
				product.comments = mapCommentsEntity(comments)
			}

			if (images.length) {
				product.images = mapImagesEntity(images)
				product.thumbnail =
					product.images.find(image => image.main) || product.images[0]
			}

			res.send(product)
		} catch (e) {
			throwServerError(res, e)
		}
	})
)

// @desc    Create new product with comments and images
// @route   POST /api/products
// @access  Public
productsRouter.route('/').post(
	asyncHandler(
		async (req: Request<{}, {}, ProductCreatePayload>, res: Response) => {
			try {
				const { title, description, price, images } = req.body
				const productId = generateId()
				await connection.query<ResultSetHeader>(INSERT_PRODUCT_QUERY, [
					productId,
					title || null,
					description || null,
					price || null
				])

				if (images) {
					const values = images.map(image => [
						generateId(),
						image.url,
						productId,
						image.main
					])
					await connection.query<ResultSetHeader>(INSERT_PRODUCT_IMAGES_QUERY, [
						values
					])
				}

				res.status(201)
				res.send(`Product id:${productId} has been added!`)
			} catch (e) {
				throwServerError(res, e)
			}
		}
	)
)

// @desc    Create new images
// @route   POST /api/products/add-images
// @access  Public
productsRouter.route('/add-images').post(
	asyncHandler(
		async (req: Request<{}, {}, ProductAddImagesPayload>, res: Response) => {
			try {
				const { productId, images } = req.body

				if (!images?.length) {
					res.status(400)
					res.send('Images array is empty')
					return
				}

				const values = images.map(image => [
					generateId(),
					image.url,
					productId,
					image.main
				])
				await connection.query<ResultSetHeader>(INSERT_PRODUCT_IMAGES_QUERY, [
					values
				])

				res.status(201)
				res.send(`Images for a product id:${productId} have been added!`)
			} catch (e) {
				throwServerError(res, e)
			}
		}
	)
)

// @desc    Remove one images
// @route   DELETE /api/products/remove-images
// @access  Public
productsRouter.route('/remove-images').delete(
	asyncHandler(
		async (req: Request<{}, {}, ImagesRemovePayload>, res: Response) => {
			try {
				const imagesToRemove = req.body

				if (!imagesToRemove?.length) {
					res.status(400)
					res.send('Images array is empty')
					return
				}

				const [info] = await connection.query<ResultSetHeader>(
					DELETE_IMAGES_QUERY,
					[[imagesToRemove]]
				)

				if (info.affectedRows === 0) {
					res.status(404)
					res.send('No one image has been removed')
					return
				}

				res.status(200)
				res.send(`Images have been removed!`)
			} catch (e) {
				throwServerError(res, e)
			}
		}
	)
)

// @desc    Remove one product by filter
// @route   DELETE /api/products/:id
// @access  Public
productsRouter.route('/:id').delete(
	asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
		try {
			const [rows] = await connection.query<IProductEntity[]>(
				'SELECT * FROM products WHERE product_id = ?',
				[req.params.id]
			)

			if (!rows?.[0]) {
				res.status(404)
				res.send(`Product with id ${req.params.id} is not found`)
				return
			}

			await connection.query<ResultSetHeader>(
				'DELETE FROM images WHERE product_id = ?',
				[req.params.id]
			)

			await connection.query<ResultSetHeader>(
				'DELETE FROM comments WHERE product_id = ?',
				[req.params.id]
			)

			await connection.query<ResultSetHeader>(
				'DELETE FROM products WHERE product_id = ?',
				[req.params.id]
			)

			res.status(200)
			res.end()
		} catch (e) {
			throwServerError(res, e)
		}
	})
)
