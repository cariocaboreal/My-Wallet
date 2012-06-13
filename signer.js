Bitcoin.Transaction.prototype.addOutputScript = function (script, value) {
    if (arguments[0] instanceof Bitcoin.TransactionOut) {
        this.outs.push(arguments[0]);
    } else {
        if (value instanceof BigInteger) {
            value = value.toByteArrayUnsigned().reverse();
            while (value.length < 8) value.push(0);
        } else if (Bitcoin.Util.isArray(value)) {
            // Nothing to do
        }

        this.outs.push(new Bitcoin.TransactionOut({
            value: value,
            script: script
        }));
    }
};

Bitcoin.Script.prototype.getOutType = function () {
    if (this.chunks.length > 3 && this.chunks[this.chunks.length-1] == Bitcoin.Opcode.map.OP_CHECKMULTISIG) {
        // Transfer to M-OF-N
        return 'Multisig';
    } else if (this.chunks.length == 5 &&
        this.chunks[0] == Bitcoin.Opcode.map.OP_DUP &&
        this.chunks[1] == Bitcoin.Opcode.map.OP_HASH160 &&
        this.chunks[3] == Bitcoin.Opcode.map.OP_EQUALVERIFY &&
        this.chunks[4] == Bitcoin.Opcode.map.OP_CHECKSIG) {
        // Transfer to Bitcoin address
        return 'Address';
    } else if (this.chunks.length == 2 &&
        this.chunks[1] == Bitcoin.Opcode.map.OP_CHECKSIG) {
        // Transfer to IP address
        return 'Pubkey';
    } else {
        return 'Strange';
    }

}

//returns m
Bitcoin.Script.prototype.extractAddresses = function (addresses)
{
    switch (this.getOutType()) {
        case 'Address':
            addresses.push(new Bitcoin.Address(this.chunks[2]));
            return 1;
        case 'Pubkey':
            addresses.push(new Bitcoin.Address(Bitcoin.Util.sha256ripe160(this.chunks[0])));
            return 1;
        case 'Multisig':
            for (var i = 1; i < this.chunks.length-2; ++i) {
                addresses.push(new Bitcoin.Address(Bitcoin.Util.sha256ripe160(this.chunks[i])));
            }
            return this.chunks[0] - Bitcoin.Opcode.map.OP_1 + 1;
        default:
            throw new Error("Encountered non-standard scriptPubKey");
    }
};

//Create an m-of-n script
Bitcoin.Script.createMultiSigOutputScript = function (m, pubkeys)
{
    var script = new Bitcoin.Script();

    script.writeOp(Bitcoin.Opcode.map.OP_1 + m - 1);

    for (var i = 0; i < pubkeys.length; ++i) {
        var pubkey = pubkeys[i];
        script.writeBytes(pubkey);
    }

    script.writeOp(Bitcoin.Opcode.map.OP_1 + pubkeys.length - 1);

    script.writeOp(Bitcoin.Opcode.map.OP_CHECKMULTISIG);

    return script;
}

//Check for inputs and get unspent for before signing
function startTxUI(el, type) {
    var pending_transaction = initNewTx();

    try {
        var total_value = 0;
        el.find('input[name="send-value"]').each(function() {
            total_value += parseFloat($(this).val());
        });

        if (total_value > 20) {
            if (type == 'email' || type == 'facebook')
                throw 'Cannot Send More Than 20 BTC via email or facebook';
            else if (type == 'quick') //Any quick transactions over 20 BTC make them custom
                type = 'custom';
        }

        var listener = {};
        if (type == 'custom') {
            var listener = {
                on_error : function(e) {
                    if (this.modal)
                        this.modal.modal('hide');
                },
                on_start : function() {
                    //Show the modal on start
                    var self = this;

                    //Create the modal
                    this.modal = $('#new-transaction-modal');

                    this.modal.modal({
                        keyboard: false,
                        backdrop: "static",
                        show: true
                    });

                    this.modal.find('#offline-transaction').hide();
                    this.modal.find('#missing-private-key').hide();
                    this.modal.find('#review-tx').hide();

                    this.modal.find('.modal-header h3').html('Creating transaction');

                    this.modal.find('#tx-sign-progress').hide();

                    //disable primary for now
                    this.modal.find('.btn.btn-primary').attr('disabled', true);

                    this.modal.find('.btn.btn-primary').text('Send Transaction');

                    this.modal.find('.btn.btn-secondary').unbind().click(function() {
                        self.error('User Cancelled');
                    });
                },
                on_begin_signing : function() {
                    $('#tx-sign-progress').show(200).find('.t').text(this.tx.ins.length);
                },
                on_sign_progress : function(i) {
                    $('#tx-sign-progress').find('.n').text(i);
                },
                on_finish_signing : function() {
                    $('#tx-sign-progress').hide(200);
                }
            };

            pending_transaction.addListener(listener);

            pending_transaction.ask_for_fee = function(yes, no) {
                var self = this;

                self.modal.hide(); //Hide the transaction progress modal

                var modal = $('#ask-for-fee');

                modal.modal({
                    keyboard: false,
                    backdrop: "static",
                    show: true
                });

                modal.find('.btn.btn-primary').unbind().click(function() {
                    yes();

                    modal.modal('hide');
                });

                modal.find('.btn.btn-secondary').unbind().click(function() {
                    no();

                    modal.modal('hide');
                });

                modal.on('hidden', function () {
                    self.modal.show();
                });
            };

            pending_transaction.ask_to_send = function(yes) {
                var self = this;
                try {
                    if (privateKeyToSweep == null)
                        self.modal.find('.modal-header h3').html('Transaction Ready to Send.');
                    else
                        self.modal.find('.modal-header h3').html('Bitcoins Ready to Claim.');

                    self.modal.find('#missing-private-key').hide();

                    self.modal.find('#review-tx').show();

                    setReviewTransactionContent(self.modal, self.tx);

                    //We have the transaction ready to send, check if were online or offline
                    var btn = self.modal.find('.btn.btn-primary');

                    setLoadingText('Checking Connectivity');

                    //Check if were able to contact blockchain.info
                    $.get(root + 'ping?'+new Date().getTime()).success(function(data) {
                        btn.attr('disabled', false);

                        btn.text('Send Transaction');

                        btn.unbind().click(function() {
                            btn.attr('disabled', true);

                            self.modal.modal('hide');

                            yes();
                        });
                    }).error(function(data) {
                            self.modal.find('.modal-header h3').html('Created Offline Transaction.');

                            btn.attr('disabled', false);

                            btn.text('Show Offline Instructions');

                            btn.unbind().click(function() {

                                btn.attr('disabled', true);

                                self.modal.find('#missing-private-key').hide();
                                self.modal.find('#review-tx').hide();
                                self.modal.find('#offline-transaction').show();

                                var s = tx.serialize();

                                var hex = Crypto.util.bytesToHex(s);

                                self.modal.find('#offline-transaction textarea[name="data"]').val(hex);
                            });

                            self.modal.center();

                            self.error('Cannot Push Transaction Offline');
                        });
                } catch (e) {
                    self.error(e);
                }
            };
        } else if (type == 'quick' || type == 'email' || type == 'facebook') {
            var listener = {
                on_error : function(e) {
                    el.find('.send').show(200);
                    if (this.p)
                        this.p.hide();
                },
                on_success : function() {
                    try {
                        el.find('.send').show(200);

                        if (this.p)
                            this.p.hide();
                    } catch (e) {
                        console.log(e);
                    }
                },
                on_start : function() {
                    this.p = el.find('.progress');

                    el.find('.send').hide();

                    this.p.show();

                    this.p.children().css('width', '10%');
                },
                on_begin_signing : function() {
                    this.p.children().css('width', '25%');
                },
                on_sign_progress : function(i) {
                    this.p.children().css('width', 25 + ((100 / this.tx.ins.length) * i) + '%');
                },
                on_finish_signing : function() {
                    this.p.children().css('width', '100%');
                }
            };

            pending_transaction.addListener(listener);

            if (type == 'email') {
                pending_transaction.ask_to_send = function(yes) {
                    var self = this;

                    var modal = $('#send-email-modal');

                    try {
                        $.post("/wallet", { guid: guid, sharedKey: sharedKey, method : 'get-info' },  function(data) {
                            try {

                                modal.modal({
                                    keyboard: true,
                                    backdrop: "static",
                                    show: true
                                });

                                var from_name = data.alias;
                                if (from_name == null)
                                    from_name = data.email

                                if (from_name == null)
                                    from_name = 'Anonymous'

                                modal.find('.amount').text(formatBTC(self.email_data.amount.toString()));

                                modal.find('.email').text(self.email_data.email);

                                modal.find('.frame').html('<iframe frameBorder="0" style="box-sizing:border-box;width:100%;height:100%" src="'+root+'email-template?from_name='+from_name+'&amount='+self.email_data.amount+'&priv=Preview&type=send-bitcoins-get"></iframe>');

                                modal.find('.btn.btn-secondary').unbind().click(function() {
                                    self.error('User Cancelled');
                                    modal.modal('hide');
                                });

                                modal.find('.btn.btn-primary').unbind().click(function() {
                                    yes();
                                    modal.modal('hide');
                                });
                            } catch (e) {
                                modal.modal('hide');

                                self.error(e);
                            }
                        }).error(function(e) {
                                modal.modal('hide');

                                self.error('Error Getting Account Data');
                            });
                    } catch (e) {
                        modal.modal('hide');

                        self.error(e);
                    }
                };
            } else if (type == 'facebook') {
                pending_transaction.ask_to_send = function(yes) {
                    var self = this;

                    try {
                        $.post("/wallet", { guid: guid, sharedKey: sharedKey, method : 'get-info' },  function(data) {
                            try {
                                var from_name = data.alias;
                                if (from_name == null)
                                    from_name = data.email

                                if (from_name == null)
                                    from_name = 'Anonymous'

                                FB.ui({
                                    display : 'iframe',
                                    method: 'send',
                                    to: self.facebook.to,
                                    link: 'https://blockchain.info/email-template?from_name='+from_name+'&amount='+self.facebook.amount+'&priv=Preview&type=send-bitcoins-get&priv='+ decryptPK(self.facebook.addr.priv)
                                }, function(response) {
                                    console.log(response);

                                    if (response && response.post_id) {
                                        console.log('Send Pressed');

                                        yes();
                                    } else {
                                        self.error('Facebook message was not sent.');
                                    }
                                });
                            } catch (e) {
                                self.error(e);
                            }
                        }).error(function(e) {
                                self.error('Error Getting Account Data');
                            });
                    } catch (e) {
                        self.error(e);
                    }
                };
            }
        }

        //Modal for when private key is missing (Watch Only)
        pending_transaction.ask_for_private_key = showPrivateKeyModal;

        getSecondPassword(function() {
            try {
                var silentReturn = false;

                //Get the from address, if any
                var fromval = el.find('select[name="from"]').val();
                if (fromval == null || fromval == 'any') {
                    pending_transaction.from_addresses = getActiveAddresses();
                } else {
                    pending_transaction.from_addresses = [fromval];
                }

                var changeAddressVal = el.find('select[name="change-addr"]').val();

                if (changeAddressVal != null) {
                    if (changeAddressVal == 'new') {
                        var generatedAddr = generateNewAddressAndKey();

                        pending_transaction.change_address = generatedAddr;

                        pending_transaction.generated_addresses.push(change_address);

                    } else if (changeAddressVal != 'any') {
                        try {
                            pending_transaction.change_address = new Bitcoin.Address(changeAddressVal);
                        } catch (e) {
                            throw 'Invalid change address: ' + e;
                        };
                    }
                }

                var input_fee = el.find('input[name="fees"]').val();

                if (input_fee != null) {
                    pending_transaction.fee = Bitcoin.Util.parseValue(input_fee);

                    if (pending_transaction.fee.compareTo(BigInteger.ZERO) < 0)
                        throw 'Fees cannot be negative';
                }

                var recipients = el.find(".recipient");

                if (recipients.length == 0) {
                    throw 'A transaction must have at least one recipient';
                }

                var try_continue = function() {
                    //Check that we have resolved all to addresses
                    if (pending_transaction.to_addresses.length < recipients.length)
                        return;

                    //If we do have the correct number of recipients start the transaction
                    pending_transaction.start();
                }

                //Constuct the recepient address array
                recipients.each(function() {
                    try {
                        var child = $(this);

                        /* Parse The Value */
                        var value_input = child.find('input[name="send-value"]');
                        var send_to_input = child.find('input[name="send-to-address"]');
                        var send_to_email_input = child.find('input[name="send-to-email"]');
                        var send_to_facebook_input = child.find('input[name="send-to-facebook"]');

                        var value = 0;
                        try {
                            value = Bitcoin.Util.parseValue(value_input.val());

                            if (value == null || value.compareTo(BigInteger.ZERO) <= 0)
                                throw 'You must enter a value greater than zero';
                        } catch (e) {
                            throw 'Invalid send amount';
                        };

                        if (send_to_input.length > 0) {
                            var send_to_address = $.trim(send_to_input.val());

                            if (send_to_address == null || send_to_address.length == 0) {
                                throw 'You must enter a bitcoin address for each recipient';
                            }  else {
                                try {
                                    pending_transaction.to_addresses.push({address: new Bitcoin.Address(send_to_address), value : value});
                                } catch (e) {

                                    //Try and Resolve Label
                                    var resolved = resolveLabel(send_to_address);

                                    if (resolved != null) {
                                        pending_transaction.to_addresses.push({address: new Bitcoin.Address(resolved), value : value});
                                    } else {
                                        //Try and Resolve firstbits
                                        apiResolveFirstbits(send_to_address, function(data) {
                                            pending_transaction.to_addresses.push({address: new Bitcoin.Address(data), value : value});

                                            //Call again now we have resolved the address
                                            try_continue();
                                        }, function() {
                                            pending_transaction.error('Invalid to address: ' + send_to_address);
                                        });

                                        return false;
                                    }
                                };
                            }
                        } else if (send_to_email_input.length > 0) {
                            var send_to_email = $.trim(send_to_email_input.val());

                            if (validateEmail(send_to_email)) {

                                //Send to email address
                                var generatedAddr = generateNewAddressAndKey();

                                //Fetch the newly generated address
                                var addr = addresses[generatedAddr.toString()];

                                addr.tag = 2;
                                addr.label = send_to_email + ' (Ready to send via email)';

                                pending_transaction.generated_addresses.push(addr.addr);

                                pending_transaction.to_addresses.push({address: generatedAddr, value : value});

                                if (pending_transaction.email)
                                    throw 'Cannot send to more than one email recipient at a time';

                                pending_transaction.email_data = {
                                    email : send_to_email,
                                    addr : addresses[generatedAddr],
                                    amount : value
                                }

                                pending_transaction.addListener({
                                    on_success : function() {
                                        try {
                                            console.log('Send confirmation');

                                            var self = this;

                                            //We send the user the private key of the newly generated address
                                            //TODO research ways of doing this without server interaction
                                            $.get(root + 'wallet/send-bitcoins-email?to=' + self.email_data.email + '&guid='+ guid + '&priv='+ decryptPK(self.email_data.addr.priv) + '&sharedKey=' + sharedKey).success(function(data) {
                                                self.email_data.addr.label = self.email_data.email  + ' (Sent via email)';

                                                //Save The New Label
                                                backupWallet();

                                                makeNotice('success', self.email_data.email, 'Sent email confirmation');
                                            });
                                        } catch (e) {
                                            console.log(e);
                                        }
                                    }
                                });
                            } else {
                                throw 'Invalid Email Address';
                            }
                        } else if (send_to_facebook_input.length > 0) {
                            var send_to_facebook = $.trim(send_to_facebook_input.val());

                            //Send to email address
                            var generatedAddr = generateNewAddressAndKey();

                            //Fetch the newly generated address
                            var addr = addresses[generatedAddr.toString()];

                            addr.tag = 2;
                            addr.label = send_to_facebook + ' (Ready to send via facebook)';

                            pending_transaction.generated_addresses.push(addr.addr);

                            pending_transaction.to_addresses.push({address: generatedAddr, value : value});

                            if (pending_transaction.facebook)
                                throw 'Cannot send to more than one facebook recipient at a time';

                            var to = send_to_facebook_input.data('fb-id');
                            if (to == null)
                                to = send_to_facebook;

                            pending_transaction.facebook = {
                                to : to,
                                addr : addresses[generatedAddr],
                                amount : value
                            }

                            pending_transaction.addListener({
                                on_success : function() {
                                    try {
                                        this.facebook.addr.label = email + ' (Sent via facebook)';

                                        //Save The New Label
                                        backupWallet();
                                    }  catch (e) {
                                        console.log(e);
                                    }
                                }
                            });

                        }

                    } catch (e) {
                        pending_transaction.error(e);
                    }
                });

                try_continue();

            } catch (e) {
                pending_transaction.error(e);
            }
        });
    } catch (e) {
        pending_transaction.error(e);
    }
    return pending_transaction;

};

function readVarInt(buff) {
    var tbyte, tbytes;

    tbyte = buff.splice(0, 1)[0];

    if (tbyte < 0xfd) {
        tbytes = [tbyte];
    } else if (tbyte == 0xfd) {
        tbytes = buff.splice(0, 2);
    } else if (tbyte == 0xfe) {
        tbytes = buff.splice(0, 4);
    } else {
        tbytes = buff.splice(0, 8);
    }

    return new BigInteger(tbytes);
}

function readUInt32(buffer) {
    return new BigInteger(buffer.splice(0, 4).reverse()).intValue();
}

Bitcoin.Transaction.deserialize = function (buffer)
{
    var tx = new Bitcoin.Transaction();

    tx.version = readUInt32(buffer);

    var txInCount = readVarInt(buffer).intValue();

    for (var i = 0; i < txInCount; i++) {

        var outPointHashBytes = buffer.splice(0,32);
        var outPointHash = Crypto.util.bytesToBase64(outPointHashBytes);

        var outPointIndex = readUInt32(buffer);

        var scriptLength = readVarInt(buffer).intValue();
        var script = new Bitcoin.Script(buffer.splice(0, scriptLength));
        var sequence = readUInt32(buffer);

        var input = new Bitcoin.TransactionIn({outpoint : {hash: outPointHash, index : outPointIndex}, script: script,  sequence: sequence});

        tx.ins.push(input);
    }

    var txOutCount = readVarInt(buffer).intValue();
    for (var i = 0; i < txOutCount; i++) {

        var valueBytes = buffer.splice(0, 8);
        var scriptLength = readVarInt(buffer).intValue();
        var script = new Bitcoin.Script(buffer.splice(0, scriptLength));

        var out = new Bitcoin.TransactionOut({script : script, value : valueBytes})

        tx.outs.push(out);
    }

    tx.lock_time = readUInt32(buffer);

    return tx;
};

function getUnspentOutputs(fromAddresses, success, error) {
    //Get unspent outputs
    setLoadingText('Getting Unspent Outputs');

    $.ajax({
        type: "POST",
        url: root +'unspent',
        data: {'addr[]' : fromAddresses, 'format' : 'json'},
        converters: {"* text": window.String, "text html": true, "text json": window.String, "text xml": $.parseXML},
        success: function(data) {
            try {
                var obj = $.parseJSON(data);

                if (obj == null) {
                    throw 'Unspent returned null object';
                }

                if (obj.error != null) {
                    throw obj.error;
                }

                if (obj.notice != null) {
                    makeNotice('notice', 'misc-notice', obj.notice);
                }
                //Save the unspent cache
                try {
                    localStorage.setItem('unspent', data);
                } catch (e) { }

                success(obj);
            } catch (e) {
                error(e);
            }
        },
        error: function (data) {
            try {
                try {
                    var cache = localStorage.getItem('unspent');

                    if (cache != null) {
                        var obj = $.parseJSON(cache);

                        success(obj);

                        return;
                    }
                } catch (e) {
                    console.log(e);
                }

                if (data.responseText)
                    throw data.responseText;
                else
                    throw 'Error Contacting Server. No unspent outputs available in cache.';

            } catch (e) {
                error(e);
            }
        }
    });
}

function signInput(tx, inputN, inputBitcoinAddress, base58Key, connectedScript) {
    var key = new Bitcoin.ECKey(base58Key);

    var compressed;
    if (key.getBitcoinAddress().toString() == inputBitcoinAddress.toString()) {
        compressed = false;
    } else if (key.getBitcoinAddressCompressed().toString() == inputBitcoinAddress.toString()) {
        compressed = true;
    } else {
        throw 'Private key does not match bitcoin address';
    }

    var hashType = parseInt(1); // SIGHASH_ALL

    var hash = sendTx.hashTransactionForSignature(connectedScript, inputN, hashType);

    var rs = key.sign(hash);

    var signature = Bitcoin.ECDSA.serializeSig(rs.r, rs.s);

    // Append hash type
    signature.push(hashType);

    var script;

    if (compressed)
        script = Bitcoin.Script.createInputScript(signature, key.getPubCompressed());
    else
        script = Bitcoin.Script.createInputScript(signature, key.getPub());

    if (script == null) {
        throw 'Error creating input script';
    }

    tx.ins[inputN].script = script;
}

function setReviewTransactionContent(modal, tx) {

    $('#rtc-hash').html(Crypto.util.bytesToHex(tx.getHash()));
    $('#rtc-version').html(tx.version);
    $('#rtc-from').html('');
    $('#rtc-to').html('');

    var total = BigInteger.ZERO;
    var total_fees =  BigInteger.ZERO;
    var wallet_effect =  BigInteger.ZERO;
    var basic_str = 'send ';
    var all_txs_to_self = true;
    var amount =  BigInteger.ZERO;

    for (var i = 0; i < tx.ins.length; ++i) {
        var input = tx.ins[i];

        total_fees = total_fees.add(input.outpoint.value);

        wallet_effect = wallet_effect.add(input.outpoint.value);

        var addr = null;
        try {
            addr = new Bitcoin.Address(input.script.simpleInPubKeyHash());
        } catch(e) {
            addr = 'Unable To Decode Address';
        }

        $('#rtc-from').append(addr + ' <font color="green">' + formatBTC(input.outpoint.value.toString()) + ' BTC <br />');
    }

    var isFirst = true;
    for (var i = 0; i < tx.outs.length; ++i) {
        var out = tx.outs[i];

        var array = out.value.slice();

        array.reverse();

        var val =  new BigInteger(array);

        var out_addresses = [];

        var m = out.script.extractAddresses(out_addresses);

        $('#rtc-to').append(formatAddresses(m, out_addresses) + ' <font color="green">' + formatBTC(val.toString()) + ' BTC </font><br />');

        total = total.add(val);

        total_fees = total_fees.subtract(val);

        //If it's an escrow transaction we always subtract it from the wallet effect
        //As technically we are not in control of the funds anymore
        if (out_addresses.length > 1) {

            if (!isFirst) {
                basic_str += ' and ';
            }

            basic_str += '<b>' + formatBTC(val.toString())  + ' BTC</b> to ' + formatAddresses(m, out_addresses, true);

            all_txs_to_self = false;

            wallet_effect = wallet_effect.subtract(val);

            //check if it's an address in our wallet
            //If it is then we don't need to subtract it from wallet effect
        } else {
            var address = out_addresses[0].toString();
            if (addresses[address] == null || addresses[address].tag == 2) {
                //Our fees
                if (address != our_address) {
                    if (!isFirst) {
                        basic_str += ' and ';
                    }

                    basic_str += '<b>' + formatBTC(val.toString())  + ' BTC</b> to ' + formatAddresses(1, [address], true);

                    all_txs_to_self = false;
                }
            } else {
                wallet_effect = wallet_effect.subtract(val);

                if (address != our_address) {
                    amount = amount.add(val);
                }
            }
        }

        isFirst = false;
    }

    if (total_fees.compareTo(BigInteger.valueOf(1).multiply(BigInteger.valueOf(satoshi))) >= 0) {
        alert('Warning fees are very high for this transaction. Please double check each output!');
    }

    if (all_txs_to_self == true) {
        if (privateKeyToSweep == null)
            basic_str = 'move <b>' + formatBTC(total.toString()) + ' BTC</b> between your own bitcoin addresses';
        else
            basic_str = 'claim <b>' + formatBTC(amount.toString()) + ' BTC</b> into your bitcoin wallet';
    }

    $('#rtc-basic-summary').html(basic_str);

    $('#rtc-effect').html("-" + formatBTC(wallet_effect.toString()) + ' BTC');

    $('#rtc-fees').html(formatBTC(total_fees.toString()) + ' BTC');

    $('#rtc-value').html(formatBTC(total.toString()) + ' BTC');
}

/*

 pending_transaction {
 change_address : BitcoinAddress
 from_addresses : [String]
 to_addresses : [{address: BitcoinAddress, value : BigInteger}]
 generated_addresses : [String]
 extra_private_keys : {addr : String, priv : ECKey}
 fee : BigInteger
 on_error : function
 on_success : function
 on_ready_to_send : function
 }
 */
function initNewTx() {
    var pending_transaction = {
        generated_addresses : [],
        to_addresses : [],
        fee : BigInteger.ZERO,
        extra_private_keys : [],
        listeners : [],
        addListener : function(listener) {
            this.listeners.push(listener);
        },
        invoke : function (cb, obj, ob2) {
            for (var key in this.listeners) {
                if (this.listeners[key][cb])
                    this.listeners[key][cb].call(this, obj, ob2);
            }
        }, start : function() {
            try {
                var self = this;

                self.invoke('on_start');

                getUnspentOutputs(this.from_addresses, function (obj) {
                    try {
                        if (obj.unspent_outputs == null || obj.unspent_outputs.length == 0) {
                            throw 'No Free Outputs To Spend';
                        }

                        self.unspent = [];

                        for (var i = 0; i < obj.unspent_outputs.length; ++i) {
                            var script;
                            try {
                                script = new Bitcoin.Script(Crypto.util.hexToBytes(obj.unspent_outputs[i].script));
                            } catch(e) {
                                makeNotice('error', 'misc-error', 'Error decoding script: ' + e); //Not a fatal error
                                continue;
                            }
                            var out = {script : script,
                                value : BigInteger.fromByteArrayUnsigned(Crypto.util.hexToBytes(obj.unspent_outputs[i].value_hex)),
                                tx_output_n : obj.unspent_outputs[i].tx_output_n,
                                tx_hash : obj.unspent_outputs[i].tx_hash,
                                confirmations : obj.unspent_outputs[i].confirmations
                            };

                            self.unspent.push(out);
                        }

                        self.makeTransaction();
                    } catch (e) {
                        this.error(e);
                    }
                }, function(e) {
                    this.error(e);
                });
            } catch (e) {
                this.error(e);
            }
        },
        //Select Outputs and Contract transaction
        makeTransaction : function() {
            var self = this;

            try {
                this.selected_outputs = [];

                var txValue = BigInteger.ZERO;

                for (var i = 0; i < this.to_addresses.length; ++i) {
                    txValue = txValue.add(this.to_addresses[i].value);
                }

                var isSweep = (this.to_addresses.length == 0);

                var isEscrow = false;

                //If we have any escrow outputs we increase the fee to 0.05 BTC
                for (var i =0; i < this.to_addresses.length; ++i) {
                    var addrObj = this.to_addresses[i];
                    if (addrObj.m != null) {
                        isEscrow = true;
                        break;
                    }
                }

                var availableValue = BigInteger.ZERO;

                //Add the miners fees
                if (this.fee != null)
                    txValue = txValue.add(this.fee);

                var priority = 0;

                for (var i in this.unspent) {
                    var out = this.unspent[i];

                    try {
                        var addr = new Bitcoin.Address(out.script.simpleOutPubKeyHash()).toString();

                        if (addr == null) {
                            throw 'Unable to decode output address from transaction hash ' + out.tx_hash;
                        }

                        if (this.from_addresses != null && this.from_addresses.length > 0 && $.inArray(addr.toString(), this.from_addresses) == -1) {
                            continue;
                        }  else {
                            availableValue = availableValue.add(out.value);
                        }

                        var hexhash = Crypto.util.hexToBytes(out.tx_hash);

                        var b64hash = Crypto.util.bytesToBase64(Crypto.util.hexToBytes(out.tx_hash));

                        //If the output happens to be greater than tx value then we can make this transaction with one input only
                        //So discard the previous selected outs
                        if (out.value.compareTo(txValue) >= 0) {
                            this.selected_outputs = [];

                            priority = out.value * out.confirmations;

                            availableValue = out.value;

                            this.selected_outputs.push(new Bitcoin.TransactionIn({outpoint: {hash: b64hash, hexhash: hexhash, index: out.tx_output_n, value:out.value}, script: out.script, sequence: 4294967295}));

                            break;
                        } else {
                            this.selected_outputs.push(new Bitcoin.TransactionIn({outpoint: {hash: b64hash, hexhash: hexhash, index: out.tx_output_n, value:out.value}, script: out.script, sequence: 4294967295}));

                            priority += out.value * out.confirmations;

                            if (!isSweep && availableValue.compareTo(txValue) >= 0)
                                break;
                        }

                    } catch (e) {
                        //An error, but probably recoverable
                        makeNotice('info', 'tx-error', e);
                    }
                }

                if (availableValue.compareTo(txValue) < 0) {
                    this.error('Insufficient funds. Value Needed ' +  formatBTC(txValue.toString()) + ' BTC. Available amount ' + formatBTC(availableValue.toString()) + ' BTC');
                    return;
                }

                if (this.selected_outputs.length == 0) {
                    this.error('No Available Outputs To Spend.');
                    return;
                }

                var sendTx = new Bitcoin.Transaction();

                for (var i = 0; i < this.selected_outputs.length; i++) {
                    sendTx.addInput(this.selected_outputs[i]);
                }

                var askforfee = false;
                for (var i =0; i < this.to_addresses.length; ++i) {
                    var addrObj = this.to_addresses[i];
                    if (addrObj.m != null) {
                        sendTx.addOutputScript(Bitcoin.Script.createMultiSigOutputScript(addrObj.m, addrObj.pubkeys), addrObj.value);
                    } else {
                        sendTx.addOutput(addrObj.address, addrObj.value);
                    }
                }

                //Now deal with the change
                var	changeValue = availableValue.subtract(txValue);
                if (changeValue.compareTo(BigInteger.ZERO) > 0) {
                    if (this.change_address != null) //If chenge address speicified return to that
                        sendTx.addOutput(this.change_address, changeValue);
                    else if (!isSweep && this.from_addresses != null && this.from_addresses.length > 0) //Else return to the from address if specified
                        sendTx.addOutput(new Bitcoin.Address(this.from_addresses[0]), changeValue);
                    else { //Otherwise return to random unarchived
                        sendTx.addOutput(new Bitcoin.Address(getPreferredAddress()), changeValue);
                    }
                }

                var forceFee = false;

                //Check for tiny outputs
                for (var i = 0; i < sendTx.outs.length; ++i) {
                    var out = sendTx.outs[i];

                    var array = out.value.slice();
                    array.reverse();
                    var val =  new BigInteger(array);

                    //If less than 0.0005 BTC force fee
                    if (val.compareTo(BigInteger.valueOf(50000)) < 0) {
                        forceFee = true;
                    } else if (val.compareTo(BigInteger.valueOf(1000000)) < 0) { //If less than 0.01 BTC show warning
                        askforfee = true;
                    }
                }

                //Estimate scripot sig (Cannot use serialized tx size yet becuase we haven't signed the inputs)
                //18 bytes standard header
                //standard scriptPubKey 24 bytes
                //Stanard scriptSig 64 bytes
                var estimatedSize = sendTx.serialize(sendTx).length + (114 * sendTx.ins.length);

                priority /= estimatedSize;

                var kilobytes = estimatedSize / 1024;

                //Priority under 57 million requires a 0.0005 BTC transaction fee (see https://en.bitcoin.it/wiki/Transaction_fees)
                if (forceFee && (this.fee == null || this.fee.intValue() == 0)) {
                    //Forced Fee
                    self.fee = BigInteger.valueOf(50000);

                    self.makeTransaction();
                } else if ((priority < 57600000 || kilobytes > 1 || isEscrow || askforfee) && self.fee.intValue() == 0) {
                    self.ask_for_fee(function() {
                        self.fee = BigInteger.valueOf(50000);

                        self.makeTransaction();
                    }, function() {
                        self.tx = sendTx;

                        self.signInputs();
                    });
                } else {
                    self.tx = sendTx;

                    self.signInputs();
                }
            } catch (e) {
                this.error(e);
            }
        },
        ask_for_fee : function(yes, no) {
            yes();
        },
        signInputs : function() {
            var self = this;

            try {
                self.invoke('on_begin_signing');

                var outputN = 0;
                var missingPrivateKeys = [];

                signOne = function() {
                    setTimeout(function() {
                        try {
                            self.invoke('on_sign_progress', outputN+1);

                            var connectedScript = self.selected_outputs[outputN].script;
                            var pubKeyHash = connectedScript.simpleOutPubKeyHash();
                            var inputBitcoinAddress = new Bitcoin.Address(pubKeyHash).toString();
                            var privatekey = null;

                            //Find the matching private key
                            var myAddr = addresses[inputBitcoinAddress];
                            if (myAddr != null) {
                                try {
                                    if (myAddr.priv != null) {
                                        privatekey = decodePK(myAddr.priv);
                                    }
                                } catch (e) {
                                    console.log(e);
                                }
                            }

                            //If it is null then it is not in our main key pool, try look in the temporary keys
                            if (privatekey == null) {
                                var extraKey = self.extra_private_keys[inputBitcoinAddress];
                                if (extraKey) {
                                    privatekey = Base58.decode(extraKey);
                                }
                            }

                            if (privatekey == null) {
                                self.ask_for_private_key(function (key) {
                                    if (inputBitcoinAddress == key.getBitcoinAddress().toString() || inputBitcoinAddress == key.getBitcoinAddressCompressed().toString()) {
                                        self.extra_private_keys[inputBitcoinAddress] = Bitcoin.Base58.encode(key.priv);

                                        signOne(); //Continue signing
                                    } else {
                                        self.error('The private key you entered does not match the bitcoin address');
                                    }

                                }, function(e) {
                                    self.error(e);

                                }, inputBitcoinAddress);
                            } else if (signInput(self.tx, outputN, inputBitcoinAddress, privatekey, connectedScript)) {
                                signOne(); //Sign The Next One
                            } else {
                                throw 'Unknown error signing transaction';
                            }
                        } catch (e) {
                            self.error(e);
                        }

                    }, 1);
                };

                signOne();
            } catch (e) {
                self.error(e);
            }
        },
        pushTx : function() {
            var self = this;

            try {
                var s = this.tx.serialize();

                var hex = Crypto.util.bytesToHex(s);

                if (hex.length >= 32768) {
                    this.error('My wallet cannot handle transactions over 32KB in size. Please try splitting your transaction,');
                }

                setLoadingText('Sending Transaction');

                var size = transactions.length;

                console.log('Push TX');

                $.post("/pushtx", { format : "plain", tx: hex }, function(data) {
                    //If we haven't received a new transaction after sometime call a manual update
                    setTimeout(function() {
                        if (transactions.length == size) {
                            queryAPIMultiAddress();

                            apiGetRejectionReason(Crypto.util.bytesToHex(tx.getHash()), function(reason) {
                                self.error(reason);
                            });
                        }
                    }, 2000);

                    self.success();

                }).error(function(data) {
                   self.error(data.responseText);
                });

            } catch (e) {
                self.error(e);
            }
        },
        ask_for_private_key : function(success, error) {
            error('Cannot ask for private key without user interaction disabled');
        },
        //Debug Print
        ask_to_send : function(yes) {
            var self = this;

            for (var i = 0; i < self.tx.ins.length; ++i) {
                var input = self.tx.ins[i];

                console.log('From : ' + new Bitcoin.Address(input.script.simpleInPubKeyHash()) + ' => ' + input.outpoint.value.toString());
            }

            var isFirst = true;
            for (var i = 0; i < self.tx.outs.length; ++i) {
                var out = self.tx.outs[i];
                var out_addresses = [];

                var m = out.script.extractAddresses(out_addresses);

                var array = out.value.slice();

                array.reverse();

                var val =  new BigInteger(array);

                console.log('To: ' + formatAddresses(m, out_addresses) + ' => ' + val.toString());
            }

            yes();
        },
        error : function(error) {
            this.is_cancelled = true;

            if (this.generated_addresses.length > 0) {
                //When an error occurs during send (or user cancelled) we need to remove the addresses we generated
                for (var key in this.generated_addresses) {
                    internalDeleteAddress(this.generated_addresses[key]);
                }

                backupWallet();
            }

            this.invoke('on_error', error);
        },
        success : function() {
            this.invoke('on_success');
        }
    };

    var base_listener = {
        on_error : function(e) {
            if(e)
                makeNotice('error', 'tx-error', e);

            $('.send').attr('disabled', false);
        },
        on_success : function(e) {
            try {
                $('.send').attr('disabled', false);
            } catch (e) {
                console.log(e);
            }
        },
        on_start : function(e) {
            $('.send').attr('disabled', true);
        }
    };

    pending_transaction.addListener(base_listener);

    return pending_transaction;
}

function signMessage(addressString, strMessage) {
    var strMessageMagic = 'Bitcoin Signed Message:\n';

    var addr = addresses[addressString];

    if (addr.priv == null) {
        makeNotice('error', 'add-error', 'Cannot sign a message with a watch only address', 0);
        return;
    }

    var eckey = new Bitcoin.ECKey(decodePK(addr.priv));

    var concenated = strMessageMagic + strMessage;

    console.log(concenated);

    var rs = eckey.sign(Crypto.SHA256(concenated, { asBytes: true }));

    console.log(rs);

    var signature = Bitcoin.ECDSA.serializeSig(rs.r, rs.s);

    return Crypto.util.bytesToBase64(signature);
}