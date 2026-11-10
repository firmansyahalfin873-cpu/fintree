// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Experimental payment splitter for a single explicitly configured ERC-20 token.
/// @dev Not audited. Only standard, non-fee-on-transfer tokens are supported.
contract FintreeSplitter is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Quote {
        bytes32 invoiceId;
        address token;
        address merchant;
        uint256 merchantAmount;
        uint256 protocolFee;
        uint256 deadline;
    }

    bytes32 public constant QUOTE_TYPEHASH = keccak256(
        "Quote(bytes32 invoiceId,address token,address merchant,uint256 merchantAmount,uint256 protocolFee,uint256 deadline)"
    );
    IERC20 public immutable token;
    address public immutable treasury;
    address public immutable quoteSigner;
    mapping(bytes32 => bool) public processedInvoices;

    error InvalidConfiguration();
    error InvalidQuote();
    error QuoteExpired();
    error InvoiceAlreadyPaid();
    error InvalidSignature();

    event PaymentFulfilled(
        bytes32 indexed invoiceId,
        address indexed merchant,
        address indexed payer,
        address token,
        uint256 merchantAmount,
        uint256 protocolFee
    );

    constructor(IERC20 token_, address treasury_, address signer_) EIP712("Fintree", "1") {
        if (address(token_).code.length == 0 || treasury_ == address(0) || signer_ == address(0)) revert InvalidConfiguration();
        token = token_;
        treasury = treasury_;
        quoteSigner = signer_;
    }

    function payInvoice(Quote calldata quote, bytes calldata signature) external nonReentrant {
        if (quote.invoiceId == bytes32(0) || quote.token != address(token) || quote.merchant == address(0) || quote.merchantAmount == 0) revert InvalidQuote();
        if (block.timestamp > quote.deadline) revert QuoteExpired();
        if (processedInvoices[quote.invoiceId]) revert InvoiceAlreadyPaid();
        bytes32 structHash = keccak256(abi.encode(
            QUOTE_TYPEHASH, quote.invoiceId, quote.token, quote.merchant,
            quote.merchantAmount, quote.protocolFee, quote.deadline
        ));
        (address recovered, ECDSA.RecoverError error,) = ECDSA.tryRecover(_hashTypedDataV4(structHash), signature);
        if (error != ECDSA.RecoverError.NoError || recovered != quoteSigner) revert InvalidSignature();

        processedInvoices[quote.invoiceId] = true;
        token.safeTransferFrom(msg.sender, quote.merchant, quote.merchantAmount);
        if (quote.protocolFee != 0) token.safeTransferFrom(msg.sender, treasury, quote.protocolFee);
        emit PaymentFulfilled(quote.invoiceId, quote.merchant, msg.sender, address(token), quote.merchantAmount, quote.protocolFee);
    }
}
